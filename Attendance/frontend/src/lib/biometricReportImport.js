import * as XLSX from "xlsx";

const MONTH_ABBR = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function cellText(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "7:58" / "13:41" -> total minutes. Report shows "00:00" for absent days.
function parseDurationMinutes(text) {
  const m = /^(\d{1,3}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// "08:06" -> "08:06:00" (Postgres time). Blank on absent days - not an error.
function parseTimeOfDay(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  return `${pad2(m[1])}:${m[2]}:00`;
}

// Parses the biometric software's "Basic Work Duration Report" export - a
// pivoted block-per-employee layout, not a flat table, so it needs its own
// parser rather than reusing the generic CSV importer (punchImport.js).
// Confirmed format (2026-08, "if anything changes we can rebuild this
// part later" - so this is deliberately tied to this exact layout, not a
// generic one):
//   - a "Jul 01 2026  To  Jul 31 2026"-style line gives the report's month/year
//   - a row whose first cell is "Days" holds day-of-month + day-abbreviation
//     headers ("1 W", "2 Th", ...) starting a few columns in, with irregular
//     blank spacer columns - so columns are mapped by reading this row
//     directly, never assumed from a fixed offset
//   - each employee is a block of rows: "Emp. Code:" (code at column 3,
//     name at column 13), then Status / InTime / OutTime / Total rows,
//     aligned to the same columns as the header row. Blocks are found by
//     searching for the next "Emp. Code:" label, not a fixed row spacing,
//     so a slightly different number of blank rows between employees is
//     tolerated even though the within-block column layout is not.
export function parseBiometricReport(arrayBuffer, fileName) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

  let year = null;
  let month = null;
  for (const row of grid.slice(0, 6)) {
    for (const cell of row) {
      const text = cellText(cell);
      const m = /([A-Za-z]{3})\w*\s+\d{1,2}\s+(\d{4})/.exec(text);
      if (m && MONTH_ABBR[m[1].slice(0, 3)] !== undefined) {
        month = MONTH_ABBR[m[1].slice(0, 3)];
        year = parseInt(m[2], 10);
        break;
      }
    }
    if (year !== null) break;
  }
  if (year === null) {
    throw new Error("Couldn't find the report's month/year (expected a line like 'Jul 01 2026 To Jul 31 2026').");
  }

  const headerRowIndex = grid.findIndex((row) => cellText(row[0]).toLowerCase() === "days");
  if (headerRowIndex === -1) {
    throw new Error("Couldn't find the 'Days' header row.");
  }
  const headerRow = grid[headerRowIndex];
  const columnToDate = {};
  headerRow.forEach((cell, colIdx) => {
    const m = /^(\d{1,2})\b/.exec(cellText(cell));
    if (m) {
      const day = parseInt(m[1], 10);
      columnToDate[colIdx] = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    }
  });
  if (Object.keys(columnToDate).length === 0) {
    throw new Error("Found the 'Days' row but no day numbers in it.");
  }

  const employees = [];
  const records = [];
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    if (cellText(grid[i][0]).toLowerCase() !== "emp. code:") continue;
    const employeeCode = cellText(grid[i][3]);
    const employeeName = cellText(grid[i][13]);
    if (!employeeCode) continue;
    employees.push({ employeeCode, employeeName });

    const statusRow = grid[i + 1] ?? [];
    const inTimeRow = grid[i + 2] ?? [];
    const outTimeRow = grid[i + 3] ?? [];
    const totalRow = grid[i + 4] ?? [];

    for (const [colIdxStr, isoDate] of Object.entries(columnToDate)) {
      const colIdx = Number(colIdxStr);
      const status = cellText(statusRow[colIdx]) || null;
      const inTime = parseTimeOfDay(cellText(inTimeRow[colIdx]));
      const outTime = parseTimeOfDay(cellText(outTimeRow[colIdx]));
      const totalMinutes = parseDurationMinutes(cellText(totalRow[colIdx]));
      if (!status && !inTime && !outTime) continue;
      records.push({
        employee_id: employeeCode,
        attendance_date: isoDate,
        status,
        in_time: inTime,
        out_time: outTime,
        total_minutes: totalMinutes,
        source_file: fileName,
      });
    }
  }

  return { year, month, employees, records };
}

// The most recent date with attendance data in employee_daily_attendance,
// optionally scoped to one branch's staff - so the admin knows which day to
// resume importing from. Returns an ISO date string or null (nothing yet).
export async function fetchLatestUploadedDate(client, branch) {
  let employeeIds = null;
  if (branch) {
    const { data: staff, error: sErr } = await client.from("staff_master").select("employee_id").eq("branch", branch);
    if (sErr) throw sErr;
    employeeIds = (staff ?? []).map((r) => r.employee_id);
    if (employeeIds.length === 0) return null;
  }
  let q = client.from("employee_daily_attendance").select("attendance_date").order("attendance_date", { ascending: false }).limit(1);
  if (employeeIds) q = q.in("employee_id", employeeIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? [])[0]?.attendance_date ?? null;
}

// Working days (excl. Sundays) inside the uploaded span that have no data - i.e.
// gaps between uploads. Requires the attendance_missing_days RPC.
export async function fetchMissingDays(client, branch) {
  const { data, error } = await client.rpc("attendance_missing_days", { p_branch: branch || null });
  if (error) throw error;
  return (data ?? []).map((r) => r.missing_date);
}

// Staff with no attendance data at all for [fromIso, toIso] (not read this
// month). Server-side via RPC, so no client row cap.
export async function fetchAttendanceNotRead(client, fromIso, toIso, branch) {
  const { data, error } = await client.rpc("attendance_not_read", {
    p_from: fromIso,
    p_to: toIso,
    p_branch: branch || null,
  });
  if (error) throw error;
  return data ?? [];
}

export async function matchAgainstStaffMaster(client, employeeCodes) {
  const uniqueCodes = [...new Set(employeeCodes)];
  const { data, error } = await client.from("staff_master").select("employee_id, employee_name").in("employee_id", uniqueCodes);
  if (error) throw error;
  const known = new Set((data ?? []).map((r) => r.employee_id));
  return {
    matchedCount: uniqueCodes.filter((c) => known.has(c)).length,
    unmatchedCodes: uniqueCodes.filter((c) => !known.has(c)),
  };
}

export async function importBiometricRecords(client, records) {
  const CHUNK = 500;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const { error } = await client.from("employee_daily_attendance").upsert(chunk, { onConflict: "employee_id,attendance_date" });
    if (error) throw error;
  }
}

// employee_daily_attendance (raw ledger, keyed by employee_id) is a
// different table from the one the calendar actually reads
// (attendance_daily_status, computed from punch_record_daily + staff_schedule,
// keyed by staff_id) - importing the report alone never touches the
// calendar. This bridges the two: for each employee_id present in staff_master,
// writes punch_record_daily (keyed by employee_id, which IS the attendance key
// now), then calls recompute_attendance_range once per matched staff member
// (one RPC call covering their whole date range, instead of one per day) to
// actually populate attendance_daily_status.
//
// A matched staff member with no staff_schedule configured yet will still
// show a blank calendar after this - compute_attendance_status intentionally
// writes nothing when there's no schedule for that weekday (see
// phase1_schema.sql). That's a separate, real prerequisite: Admin ->
// Configure Staff Schedule for that person.
export async function bridgeToAttendancePipeline(client, employeeIds, fromDate, toDate) {
  // Page through the reads: Supabase caps a single response at ~1000 rows, and a
  // month across all staff is many thousands of daily rows. Fetching in one shot
  // silently dropped everyone past the first ~1000 rows (staff deep in the
  // report never got bridged). employeeIds is an OPTIONAL filter (used by the
  // single-person retry); when null, every employee in the date range is bridged.
  const PAGE = 1000;

  const dailyRows = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = client
      .from("employee_daily_attendance")
      .select("employee_id, attendance_date, in_time, out_time")
      .gte("attendance_date", fromDate)
      .lte("attendance_date", toDate)
      .order("employee_id", { ascending: true })
      .order("attendance_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (employeeIds && employeeIds.length) q = q.in("employee_id", employeeIds);
    const { data, error } = await q;
    if (error) throw error;
    dailyRows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // The attendance key IS employee_id now, so "bridging" is just: keep the rows
  // whose employee_id exists in staff_master, and use employee_id as staff_id.
  const knownEmployeeIds = new Set();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("staff_master")
      .select("employee_id")
      .order("employee_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    (data ?? []).forEach((r) => r.employee_id && knownEmployeeIds.add(r.employee_id));
    if (!data || data.length < PAGE) break;
  }

  const byStaffId = new Map(); // staffId(=employee_id) -> { staffId, dates: [], rows: [] }
  const noEmailInMaster = new Set(); // employee_id absent from staff_master entirely
  const noStaffRolesAccount = new Set(); // reserved (kept for the import UI's counters)

  for (const row of dailyRows ?? []) {
    const staffId = knownEmployeeIds.has(row.employee_id) ? row.employee_id : null;
    if (!staffId) {
      noEmailInMaster.add(row.employee_id);
      continue;
    }
    if (!byStaffId.has(staffId)) byStaffId.set(staffId, { staffId, dates: [], rows: [] });
    const entry = byStaffId.get(staffId);
    entry.dates.push(row.attendance_date);
    entry.rows.push({
      staff_id: staffId,
      attendance_date: row.attendance_date,
      first_in_time: row.in_time,
      last_out_time: row.out_time,
      raw_punch_count: (row.in_time ? 1 : 0) + (row.out_time ? 1 : 0),
    });
  }

  const CHUNK = 500;
  for (const { rows } of byStaffId.values()) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await client
        .from("punch_record_daily")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "staff_id,attendance_date" });
      if (error) throw error;
    }
  }

  for (const { staffId, dates } of byStaffId.values()) {
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const { error } = await client.rpc("recompute_attendance_range", { p_staff_id: staffId, p_from: minDate, p_to: maxDate });
    if (error) throw error;
  }

  return {
    bridgedStaffCount: byStaffId.size,
    bridgedRecordCount: [...byStaffId.values()].reduce((sum, e) => sum + e.rows.length, 0),
    noEmailInMasterCount: noEmailInMaster.size,
    noStaffRolesAccountCount: noStaffRolesAccount.size,
  };
}
