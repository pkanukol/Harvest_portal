// The grades the school runs, for every Grade picker in the app. Kept in one
// place so adding or removing a grade is a single edit rather than a hunt
// through four screens. Curriculum workbooks are imported for Grades 1-10
// today (excel_import.VALID_GRADES); 11 and 12 are selectable so a grade can
// be looked at as soon as its mapping is uploaded.
export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// The school's campuses, in the order reports show them. Mirrors
// crud.BRANCHES on the backend.
export const BRANCHES = ["Kodathi", "Attibele"];
