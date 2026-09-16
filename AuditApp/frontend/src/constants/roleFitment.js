// Role Fitment Report — probation evaluation. Each period has 3 parameters (scored /5) and,
// per the doc, a set of OBSERVERS (HOD / Principal / Block Head) who each score the
// parameters and add a remark in their own block.
export const ROLE_FITMENT_PERIODS = [
  {
    key: "first_month",
    label: "First Month Evaluation",
    parameters: [
      { key: "understanding_of_role", label: "Understanding of Role & Responsibilities",
        hints: ["Clarity about their role", "Initiative to learn responsibilities"] },
      { key: "adaptability_to_culture", label: "Adaptability to School Culture",
        hints: ["Adapting to the ethos", "Aligned with CBSE / IB / Montessori values"] },
      { key: "basic_performance", label: "Basic Performance Indicators",
        hints: ["Punctuality & attendance", "Relationships", "Communication skills"] },
    ],
    observers: ["hod", "principal"],
  },
  {
    key: "third_month",
    label: "Third Month Evaluation",
    parameters: [
      { key: "professional_competence", label: "Professional Competence",
        hints: ["Delivering on responsibilities", "Meeting deadlines"] },
      { key: "collaboration_teamwork", label: "Collaboration & Teamwork",
        hints: ["Works well with colleagues", "Positive with students"] },
      { key: "innovative_practices", label: "Innovative Practices",
        hints: ["Creative teaching methods", "Suggests improvements"] },
    ],
    observers: ["hod", "block_head", "principal"],
  },
  {
    key: "sixth_month",
    label: "Sixth Month Evaluation",
    parameters: [
      { key: "teaching_effectiveness", label: "Effectiveness in Teaching / Role Delivery",
        hints: ["Meets expectations consistently", "Implements the curriculum"] },
      { key: "contribution_to_growth", label: "Contribution to School's Growth",
        hints: ["Participates in events/projects", "Mentors / inspires students"] },
      { key: "continuous_learning", label: "Continuous Learning",
        hints: ["Self-improvement / training", "Receptive to feedback"] },
    ],
    observers: ["hod", "principal"],
  },
  {
    key: "ninth_month",
    label: "Ninth Month Evaluation (Final Probation Review)",
    parameters: [
      { key: "role_fitment", label: "Role Fitment",
        hints: ["Strong alignment with the role", "Ready for confirmation"] },
      { key: "leadership_potential", label: "Leadership Potential",
        hints: ["Potential for leadership / more responsibility"] },
      { key: "long_term_contribution", label: "Long-Term Contribution",
        hints: ["Committed to vision & mission", "Strong relationships all round"] },
    ],
    observers: ["hod", "block_head", "principal"],
  },
];

export const PERIOD_LABEL = Object.fromEntries(ROLE_FITMENT_PERIODS.map((p) => [p.key, p.label]));

export const OBSERVER_LABEL = {
  hod: "HOD",
  principal: "Principal",
  block_head: "Block Head (Coordinator)",
};

// Allowed designations (mirrors backend ROLE_FITMENT_DESIGNATIONS). "Block Head" = Coordinator.
const ALLOWED_DESIGNATIONS = [
  "chairman", "managing director", "principal", "vice principal",
  "coordinator", "hod", "dlp manager", "apm", "head mistress", "curriculum head", "hr",
];

export function canUseRoleFitment(user) {
  const d = (user?.designation || "").trim().toLowerCase();
  return ALLOWED_DESIGNATIONS.includes(d);
}

// Academic year: May (this year) -> April (next year). Month 1 = last week of June, so
// 1st = late Jun, 3rd = late Aug, 6th = late Nov, 9th = late Feb (Nth month = June + N-1).
export function currentAcademicYearStart(today = new Date()) {
  const y = today.getFullYear();
  return today.getMonth() >= 4 ? y : y - 1; // month index 4 = May
}

export function defaultPeriodDate(periodKey, ayStart) {
  const map = {
    first_month: [ayStart, 5, 24],        // 24 Jun
    third_month: [ayStart, 7, 24],        // 24 Aug
    sixth_month: [ayStart, 10, 24],       // 24 Nov
    ninth_month: [ayStart + 1, 1, 24],    // 24 Feb (next year)
  };
  const [yr, mo, d] = map[periodKey] || map.first_month;
  return `${yr}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// True if the date-of-joining (ISO string or Date) falls in the current academic year.
export function joinedThisYear(doj) {
  if (!doj) return false;
  const d = new Date(doj);
  if (Number.isNaN(d.getTime())) return false;
  const start = currentAcademicYearStart();
  const s = new Date(start, 4, 1);        // 1 May
  const e = new Date(start + 1, 3, 30);   // 30 Apr next year
  return d >= s && d <= e;
}
