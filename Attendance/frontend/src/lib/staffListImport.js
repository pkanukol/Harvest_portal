import * as XLSX from "xlsx";

// The staff_list workbook has one sheet per HR category. Sheet name -> the
// staff_master.category enum value. Matched case-insensitively on the trimmed
// sheet name; any sheet not in this map is skipped (and reported).
const TAB_TO_CATEGORY = {
  CBSE: "CBSE",
  "CURRICULUM TEAM": "CURR",
  PARTTIME: "PT",
  "ACAD-ADMIN": "ACAD",
  ADMIN: "ADMIN",
  IB: "IB",
  MONT: "MONT",
};

const MONTH_ABBR = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function cellText(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

// "09-May-2024" / "9-May-2024" -> "2024-05-09". Returns null for blanks or
// anything that doesn't match (dates in this sheet are dd-Mon-yyyy).
function parseJoiningDate(text) {
  const t = cellText(text);
  if (!t) return null;
  const m = /^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/.exec(t);
  if (!m) return null;
  const mon = MONTH_ABBR[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${String(m[1]).padStart(2, "0")}`;
}

// Finds the column index of each field from the header row (the row that
// contains "Employee ID"), so a shifted column order still parses correctly.
function columnMap(headerRow) {
  const idx = { name: -1, id: -1, doj: -1, email: -1 };
  headerRow.forEach((cell, i) => {
    const h = cellText(cell).toLowerCase();
    if (h.includes("employee name") || (h === "name")) idx.name = i;
    else if (h.includes("employee id") || h === "emp id" || h === "emp code") idx.id = i;
    else if (h.includes("date of joining") || h.includes("joining")) idx.doj = i;
    else if (h.includes("email")) idx.email = i;
  });
  return idx;
}

// Parses the whole staff_list workbook into staff_master-shaped rows.
// Returns { rows, perCategory, skippedSheets, warnings }.
export function parseStaffListWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  const rows = [];
  const perCategory = {};
  const skippedSheets = [];
  const warnings = [];
  const seenIds = new Map(); // employee_id -> category (to flag cross-sheet dupes)

  for (const sheetName of workbook.SheetNames) {
    const category = TAB_TO_CATEGORY[sheetName.trim().toUpperCase()];
    if (!category) {
      skippedSheets.push(sheetName);
      continue;
    }

    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
    const headerIdx = grid.findIndex((r) => r.some((c) => /employee id/i.test(cellText(c))));
    if (headerIdx === -1) {
      warnings.push(`Sheet "${sheetName}": no "Employee ID" header row found - skipped.`);
      continue;
    }
    const cols = columnMap(grid[headerIdx]);
    if (cols.id === -1 || cols.name === -1) {
      warnings.push(`Sheet "${sheetName}": couldn't find Name/Employee ID columns - skipped.`);
      continue;
    }

    let count = 0;
    for (const row of grid.slice(headerIdx + 1)) {
      const employeeId = cellText(row[cols.id]);
      const name = cellText(row[cols.name]);
      if (!employeeId && !name) continue; // blank spacer row
      if (!employeeId) {
        warnings.push(`Sheet "${sheetName}": "${name || "(no name)"}" has no Employee ID - skipped.`);
        continue;
      }
      if (seenIds.has(employeeId)) {
        warnings.push(`Employee ID ${employeeId} appears more than once (sheets ${seenIds.get(employeeId)} & ${category}) - last one wins.`);
      }
      seenIds.set(employeeId, category);

      const email = cols.email >= 0 ? cellText(row[cols.email]) : "";
      rows.push({
        employee_id: employeeId,
        employee_name: name || employeeId,
        date_of_joining: cols.doj >= 0 ? parseJoiningDate(row[cols.doj]) : null,
        category,
        email: email || null,
      });
      count += 1;
    }
    perCategory[category] = (perCategory[category] || 0) + count;
  }

  // De-dupe by employee_id (last occurrence wins) so the upsert doesn't hit the
  // same conflict key twice in one batch.
  const byId = new Map();
  rows.forEach((r) => byId.set(r.employee_id, r));
  const deduped = [...byId.values()];

  return { rows: deduped, perCategory, skippedSheets, warnings, totalParsed: rows.length };
}

// Upserts staff_master by employee_id (its unique key). The chosen `branch` is
// stamped on every row in this upload. Existing people are updated in place, new
// ones inserted; nobody is deleted. Missing emails are stored as null.
export async function importStaffList(client, rows, branch) {
  const CHUNK = 500;
  let upserted = 0;
  const withBranch = rows.map((r) => ({ ...r, branch: branch || null }));
  for (let i = 0; i < withBranch.length; i += CHUNK) {
    const chunk = withBranch.slice(i, i + CHUNK);
    const { error } = await client.from("staff_master").upsert(chunk, { onConflict: "employee_id" });
    if (error) throw error;
    upserted += chunk.length;
  }
  return { upserted };
}
