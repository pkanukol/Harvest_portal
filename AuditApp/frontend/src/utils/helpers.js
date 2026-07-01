export function ratingClass(r) {
  if (!r) return "rating-beg";
  const u = r.toUpperCase();
  if (u === "DISTINGUISHED") return "rating-dist";
  if (u === "PROFICIENT") return "rating-prof";
  if (u === "DEVELOPING") return "rating-dev";
  return "rating-beg";
}

export function ratingBarClass(r) {
  return ratingClass(r);
}

export function scoreColorClass(r) {
  if (!r) return "sc-beg";
  const u = r.toUpperCase();
  if (u === "DISTINGUISHED") return "sc-dist";
  if (u === "PROFICIENT") return "sc-prof";
  if (u === "DEVELOPING") return "sc-dev";
  return "sc-beg";
}

export function formatDateStr(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function esc(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function calculateScores(formScores) {
  const d1 = formScores.p11 + formScores.p12;
  const d2 = formScores.p21;
  const d3 = formScores.p31 + formScores.p32 + formScores.p33 + formScores.p34;
  const total = d1 + d2 + d3;

  let rating = "BEGINNING";
  if (total >= 23) rating = "DISTINGUISHED";
  else if (total >= 17) rating = "PROFICIENT";
  else if (total >= 12) rating = "DEVELOPING";

  return { d1, d2, d3, total, rating };
}

export const EMPTY_SCORES = {
  p11: 0,
  p12: 0,
  p21: 0,
  p31: 0,
  p32: 0,
  p33: 0,
  p34: 0,
};

export const SUBJECTS = [
  "Biology",
  "Chemistry",
  "Computer Science",
  "English",
  "Hindi",
  "Kannada",
  "Mathematics",
  "Physics",
  "Science",
  "Social Science",
];

export const GRADES = Array.from({ length: 10 }, (_, i) => `Grade ${i + 1}`);
export const SECTIONS = ["Section A", "Section B", "Section C", "Section D", "Section E"];
