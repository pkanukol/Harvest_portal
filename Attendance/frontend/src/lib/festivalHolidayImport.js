import * as XLSX from "xlsx";

// Header text -> festival_holiday.category. IB/MONT columns are read but
// dropped entirely - CBSE-first rollout (staff_master has no IB/MONT rows
// to expand into yet either).
const CATEGORY_HEADER_MAP = {
  studentscbse: "STUDENTS_CBSE",
  cbse: "CBSE",
  acadadmin: "ACAD",
  admin: "ADMIN",
  curriculumteam: "CURR",
};

// Categories that map onto a real staff_master.category value, and
// therefore expand into staff_holiday rows. STUDENTS_CBSE has no staff
// category (it's for students) - stored in festival_holiday for
// record-keeping only, never expanded.
const STAFF_EXPANDABLE_CATEGORIES = new Set(["CBSE", "ACAD", "ADMIN", "CURR"]);

// Day-first, as confirmed against the real file (Holiday_list_final_2026-27.csv) -
// the Date column is a full date, not a bare day-of-month, and the sheet
// spans two calendar years (e.g. Ambedkar Jayanti appears twice: 14-04-2026
// and 14-04-2027). Accepts BOTH "dd-mm-yyyy" and "d/m/yy" - the file has a
// mixed format (Excel auto-converts some cells that "look like a date" into
// its own locale short-date text on save, e.g. "01-11-2026" became
// "1/11/26"), which silently dropped every affected row (Nov 9/10 among
// them) when only the hyphenated 4-digit-year form was accepted. Both
// separators are day-first, confirmed against known dates (Gandhi Jayanti
// = Oct 2 -> "2/10/26", not Feb 10; May Day = May 1 -> "1/5/26", not Jan 5).
const DATE_RE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/;

function parseDdMmYyyy(text) {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yStr] = m;
  const year = yStr.length === 2 ? 2000 + parseInt(yStr, 10) : parseInt(yStr, 10);
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function normalizeHeader(text) {
  return String(text ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

export function parseFestivalHolidayXlsx(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

  const headerRowIndex = grid.findIndex((row) => row.some((c) => normalizeHeader(c) === "festival"));
  if (headerRowIndex === -1) {
    throw new Error("Couldn't find a header row with a 'Festival' column.");
  }
  const headerRow = grid[headerRowIndex];

  let dayCol = -1;
  let dateCol = -1;
  let festivalCol = -1;
  const categoryCols = [];
  headerRow.forEach((cell, colIdx) => {
    const norm = normalizeHeader(cell);
    if (norm === "day") dayCol = colIdx;
    else if (norm === "date") dateCol = colIdx;
    else if (norm === "festival") festivalCol = colIdx;
    else if (CATEGORY_HEADER_MAP[norm]) categoryCols.push({ colIdx, category: CATEGORY_HEADER_MAP[norm] });
  });
  if (festivalCol === -1 || dateCol === -1) {
    throw new Error("Missing one of the Festival / Date columns.");
  }
  if (categoryCols.length === 0) {
    throw new Error("No recognized category columns found (Students_CBSE / CBSE / Acad Admin / Admin / Curriculum Team).");
  }

  const rows = [];
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    const festivalName = cellText(row[festivalCol]);
    const holidayDate = parseDdMmYyyy(cellText(row[dateCol]));
    if (!festivalName || !holidayDate) continue;

    const categories = {};
    categoryCols.forEach(({ colIdx, category }) => {
      const v = cellText(row[colIdx]).toLowerCase();
      // "Sunday" means "already a holiday for everyone via the weekly off day" -
      // counts as Yes for every category, same as any other observed holiday.
      categories[category] = v === "yes" || v === "y" || v === "true" || v === "sunday";
    });
    rows.push({ festivalName, dayName: cellText(row[dayCol]), holidayDate, categories });
  }
  return rows;
}

// Writes festival_holiday (one row per date+category marked "Yes"), then
// expands the staff-facing categories into the EXISTING staff_holiday table
// (one row per matching staff_master member) - compute_attendance_status
// already checks staff_holiday, so no change to that function is needed.
// Reads staff_id straight off staff_master (Phase A), then recomputes each
// affected staff member's attendance over the holiday date range so calendars
// update immediately.
export async function importFestivalHolidays(client, rows, importedBy, branch) {
  // Keyed by the same (holiday_date, category) pair the table's unique
  // constraint uses - a Map collapses two sheet rows that land on the same
  // date+category (e.g. two festivals same day, both marked "Yes" for the
  // same category) into one, last-wins. Without this, upserting two rows
  // with an identical conflict key in the same INSERT fails outright
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  const festivalRowsByKey = new Map();
  rows.forEach((r) => {
    const activeCategories = Object.entries(r.categories).filter(([, isYes]) => isYes);
    // Every category marked "No" - not "Sunday" (that's already Yes by the
    // time we get here, see parseFestivalHolidayXlsx) - means the school
    // isn't observing this festival as a holiday this year. Nothing to
    // record: not a day off for anyone, so no festival_holiday row either.
    if (activeCategories.length === 0) return;
    activeCategories.forEach(([category]) => {
      festivalRowsByKey.set(`${r.holidayDate}|${category}`, {
        holiday_date: r.holidayDate,
        festival_name: r.festivalName,
        category,
        imported_by: importedBy,
      });
    });
  });
  const festivalRows = [...festivalRowsByKey.values()];
  if (festivalRows.length === 0) return { festivalRowCount: 0, staffHolidayCount: 0, staffCount: 0 };

  const CHUNK = 500;
  for (let i = 0; i < festivalRows.length; i += CHUNK) {
    const { error } = await client
      .from("festival_holiday")
      .upsert(festivalRows.slice(i, i + CHUNK), { onConflict: "holiday_date,category" });
    if (error) throw error;
  }

  const staffCategoriesNeeded = [...new Set(festivalRows.map((r) => r.category).filter((c) => STAFF_EXPANDABLE_CATEGORIES.has(c)))];
  if (staffCategoriesNeeded.length === 0) {
    return { festivalRowCount: festivalRows.length, staffHolidayCount: 0, staffCount: 0 };
  }

  // The attendance key is employee_id (Phase A), which staff_master owns, so the
  // category -> staff expansion reads it directly. `branch` (optional) scopes the
  // expansion to one branch; null/undefined = all branches.
  let masterQuery = client.from("staff_master").select("category, employee_id, branch").in("category", staffCategoriesNeeded);
  if (branch) masterQuery = masterQuery.eq("branch", branch);
  const { data: masterRows, error: masterError } = await masterQuery;
  if (masterError) throw masterError;

  const staffIdsByCategory = new Map(); // category -> Set(employee_id)
  (masterRows ?? []).forEach((r) => {
    if (!r.employee_id) return;
    if (!staffIdsByCategory.has(r.category)) staffIdsByCategory.set(r.category, new Set());
    staffIdsByCategory.get(r.category).add(r.employee_id);
  });

  // staffId -> Map(holiday_date -> row) - same dedup reasoning as
  // festivalRowsByKey above, keyed by staff_holiday's own unique
  // constraint (staff_id, holiday_date). A staff member could otherwise be
  // hit twice for the same date if staff_master has more than one row for
  // them (e.g. a stale duplicate entry) under a category also marked "Yes".
  const holidayRowsByStaff = new Map(); // staffId -> Map(holiday_date -> row)
  festivalRows.forEach((fr) => {
    const staffIds = staffIdsByCategory.get(fr.category);
    if (!staffIds) return;
    staffIds.forEach((staffId) => {
      if (!holidayRowsByStaff.has(staffId)) holidayRowsByStaff.set(staffId, new Map());
      holidayRowsByStaff.get(staffId).set(fr.holiday_date, {
        staff_id: staffId,
        holiday_date: fr.holiday_date,
        label: fr.festival_name,
        source: "bulk_import",
      });
    });
  });

  let staffHolidayCount = 0;
  for (const [staffId, holidayRowsMap] of holidayRowsByStaff) {
    const holidayRows = [...holidayRowsMap.values()];
    for (let i = 0; i < holidayRows.length; i += CHUNK) {
      const chunk = holidayRows.slice(i, i + CHUNK);
      const { error } = await client.from("staff_holiday").upsert(chunk, { onConflict: "staff_id,holiday_date" });
      if (error) throw error;
      staffHolidayCount += chunk.length;
    }
    const dates = holidayRows.map((r) => r.holiday_date);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const { error: rpcError } = await client.rpc("recompute_attendance_range", { p_staff_id: staffId, p_from: minDate, p_to: maxDate });
    if (rpcError) throw rpcError;
  }

  return {
    festivalRowCount: festivalRows.length,
    staffHolidayCount,
    staffCount: holidayRowsByStaff.size,
  };
}

// For the calendar to label a date with its festival name, regardless of
// category. If a date has more than one festival_holiday row (e.g.
// genuinely two different category-specific festivals on the same day),
// names are joined.
export async function fetchFestivalNamesForRange(client, fromDate, toDate) {
  const { data, error } = await client
    .from("festival_holiday")
    .select("holiday_date, festival_name")
    .gte("holiday_date", fromDate)
    .lte("holiday_date", toDate);
  if (error) throw error;
  const byDate = {};
  (data ?? []).forEach((row) => {
    if (!byDate[row.holiday_date]) byDate[row.holiday_date] = row.festival_name;
    else if (!byDate[row.holiday_date].includes(row.festival_name)) byDate[row.holiday_date] += `, ${row.festival_name}`;
  });
  return byDate;
}
