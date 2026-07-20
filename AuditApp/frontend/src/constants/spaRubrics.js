// SPA (Sports / Performing Arts) Observation Form — 2026-27
// Each criterion has its own rating scale with a varying max score (not a fixed
// 4-point rubric like the classroom Observation form), so criteria are stored as
// {key: {score, comment}} rather than fixed columns. Sum of all maxes = 40.
export const SPA_CRITERIA = [
  { key: "c1", label: "Commencement of class on time", options: [{ score: 0, label: "No" }, { score: 1, label: "Yes" }] },
  { key: "c2", label: "Warm-up session at the start", options: [{ score: 0, label: "No" }, { score: 1, label: "Yes" }] },
  { key: "c3", label: "Involvement of all the children", options: [{ score: 0, label: "No" }, { score: 1, label: "Yes" }] },
  { key: "c4", label: "Adherence to the Curriculum plan", options: [{ score: 0, label: "Not done" }, { score: 1, label: "Done" }] },
  { key: "c5", label: "Clarity of instructions", options: [{ score: 0, label: "Poor" }, { score: 1, label: "Fair" }, { score: 2, label: "Good" }, { score: 3, label: "V. Good" }] },
  { key: "c6", label: "Maintenance of discipline", options: [{ score: 0, label: "Poor" }, { score: 1, label: "Fair" }, { score: 2, label: "Good" }, { score: 3, label: "V. Good" }] },
  { key: "c7", label: "Effective lesson delivery", options: [{ score: 0, label: "Poor" }, { score: 1, label: "Fair" }, { score: 2, label: "Good" }, { score: 3, label: "V. Good" }] },
  { key: "c8", label: "Awareness of rules & proper guidance on rules of the game", options: [{ score: 0, label: "No" }, { score: 1, label: "Yes" }] },
  { key: "c9", label: "Doubt clarification for students", options: [{ score: 0, label: "No" }, { score: 1, label: "Partially" }, { score: 2, label: "Completely" }] },
  { key: "c10", label: "Attendance maintenance", options: [{ score: 0, label: "Not maintained" }, { score: 1, label: "Partial" }, { score: 2, label: "Full" }] },
  { key: "c11", label: "Coach's attire and presentability", options: [{ score: 0, label: "Poor" }, { score: 1, label: "Fair" }, { score: 2, label: "Good" }] },
  { key: "c12", label: "Activity-specific skill development", options: [{ score: 0, label: "Not observed" }, { score: 1, label: "Attempted" }, { score: 2, label: "Effectively done" }, { score: 3, label: "Well Done" }] },
  { key: "c13", label: "Use of equipment/props/space", options: [{ score: 0, label: "Poor" }, { score: 1, label: "Fair" }, { score: 2, label: "Good" }, { score: 3, label: "Excellent" }] },
  { key: "c14", label: "Safety & risk management", options: [{ score: 0, label: "Unsafe" }, { score: 1, label: "Partially safe" }, { score: 2, label: "Safe" }, { score: 3, label: "Took proactive measures" }] },
  { key: "c15", label: "Inclusivity & adaptation", options: [{ score: 0, label: "Not attempted" }, { score: 1, label: "Some effort" }, { score: 2, label: "Adapted effectively" }, { score: 3, label: "Well done" }] },
  { key: "c16", label: "Creativity & student expression", options: [{ score: 0, label: "None" }, { score: 1, label: "Limited" }, { score: 2, label: "Encouraged" }, { score: 3, label: "Strongly encouraged" }] },
  { key: "c17", label: "Classroom management strategy", options: [{ score: 0, label: "Poor" }, { score: 1, label: "Fair" }, { score: 2, label: "Good" }, { score: 3, label: "Excellent" }] },
  { key: "c18", label: "Reflection & feedback loop", options: [{ score: 0, label: "No" }, { score: 1, label: "Some" }, { score: 2, label: "Timely and Constructive" }] },
];

export const SPA_MAX_SCORE = SPA_CRITERIA.reduce(
  (sum, c) => sum + Math.max(...c.options.map((o) => o.score)),
  0
); // 40

export const EMPTY_SPA_CRITERIA_SCORES = SPA_CRITERIA.reduce((acc, c) => {
  acc[c.key] = { score: null, comment: "" };
  return acc;
}, {});
