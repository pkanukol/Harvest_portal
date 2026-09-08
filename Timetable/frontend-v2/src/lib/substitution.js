// Ranks substitute-teacher candidates for every period a specific teacher has
// on a given day, per the school's actual preference order (confirmed by the
// user 2026-07-31, deduped across tiers 2026-08-01):
//   1. Same grade, same subject (any other section)
//   2. Same grade, any other subject
//   3. "More" - next grade down, one grade per click, capped at 3 grades
//      below the absent period's grade
//   4. "More" - any free SPA teacher
//   5. "More" - any free PE teacher
//   6. "More" - any other free teacher
// Within a tier, the least-loaded candidate (fewest periods that day, then
// fewest that week) is listed first. A teacher only ever appears in the
// FIRST (highest-priority) tier they qualify for - once claimed there,
// later tiers exclude them, so the UI never has to de-dup on display and a
// name never appears twice across a period's suggestions.

const SPA_RE = /\bspa\b/i;
const PE_RE = /\bpe\b/i;

function norm(s) {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function gradeNumber(gradeName) {
  const m = (gradeName || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// lessons: the whole week's placed, teacher-assigned lessons - each
// {day_of_week, period_number, grade_name, section_name, subject, teacher_name}.
export function computeSuggestions(lessons, absentTeacherName, dayOfWeek, allTeacherNames) {
  const absentKey = norm(absentTeacherName);

  const displayName = new Map();
  for (const n of allTeacherNames) {
    if (n) displayName.set(norm(n), n);
  }
  for (const l of lessons) {
    if (l.teacher_name && !displayName.has(norm(l.teacher_name))) {
      displayName.set(norm(l.teacher_name), l.teacher_name);
    }
  }

  const occupiedPeriod = new Map(); // teacherKey -> Set(period_number) busy on dayOfWeek
  const teacherSubjects = new Map(); // teacherKey -> Set(subject, lowercased)
  const teacherGrades = new Map(); // teacherKey -> Set(grade_name)
  const teacherDayCount = new Map();
  const teacherWeekCount = new Map();

  for (const l of lessons) {
    if (!l.teacher_name) continue;
    const key = norm(l.teacher_name);
    if (!teacherSubjects.has(key)) teacherSubjects.set(key, new Set());
    teacherSubjects.get(key).add(norm(l.subject));
    if (!teacherGrades.has(key)) teacherGrades.set(key, new Set());
    teacherGrades.get(key).add(l.grade_name);
    teacherWeekCount.set(key, (teacherWeekCount.get(key) || 0) + 1);
    if (l.day_of_week === dayOfWeek) {
      if (!occupiedPeriod.has(key)) occupiedPeriod.set(key, new Set());
      occupiedPeriod.get(key).add(l.period_number);
      teacherDayCount.set(key, (teacherDayCount.get(key) || 0) + 1);
    }
  }

  const absentPeriods = lessons
    .filter((l) => norm(l.teacher_name) === absentKey && l.day_of_week === dayOfWeek)
    .slice()
    .sort((a, b) => a.period_number - b.period_number);

  const allKeys = [...displayName.keys()].filter((k) => k !== absentKey);

  function rank(keys) {
    return keys
      .slice()
      .sort((a, b) => {
        const da = teacherDayCount.get(a) || 0;
        const db_ = teacherDayCount.get(b) || 0;
        if (da !== db_) return da - db_;
        const wa = teacherWeekCount.get(a) || 0;
        const wb = teacherWeekCount.get(b) || 0;
        if (wa !== wb) return wa - wb;
        return displayName.get(a) < displayName.get(b) ? -1 : displayName.get(a) > displayName.get(b) ? 1 : 0;
      })
      .map((k) => ({
        teacher_name: displayName.get(k),
        periods_today: teacherDayCount.get(k) || 0,
        periods_week: teacherWeekCount.get(k) || 0,
      }));
  }

  // Distinct grade names actually present, so "3 grades below" can be
  // resolved to a real grade name (e.g. Grade 9 -> Grade 6), not just a
  // number that might not correspond to an actual grade in this data.
  const gradeNumToName = new Map();
  for (const l of lessons) {
    const gn = gradeNumber(l.grade_name);
    if (gn !== null && !gradeNumToName.has(gn)) gradeNumToName.set(gn, l.grade_name);
  }

  const periodsOut = [];
  for (const ap of absentPeriods) {
    const { period_number: period, grade_name: grade, section_name: section, subject } = ap;
    const subjNorm = norm(subject);
    const gradeNum = gradeNumber(grade);

    const free = allKeys.filter((k) => !(occupiedPeriod.get(k) || new Set()).has(period));

    // Each tier claims candidates from `free`, minus whoever an earlier
    // (higher-priority) tier already claimed - so every name appears at
    // most once across the whole period's suggestions.
    const claimed = new Set();
    function claim(keys) {
      const fresh = keys.filter((k) => !claimed.has(k));
      fresh.forEach((k) => claimed.add(k));
      return rank(fresh);
    }

    const sameGradeSameSubject = claim(
      free.filter((k) => (teacherGrades.get(k) || new Set()).has(grade) && (teacherSubjects.get(k) || new Set()).has(subjNorm))
    );
    const sameGradeOtherSubject = claim(free.filter((k) => (teacherGrades.get(k) || new Set()).has(grade)));

    const lowerGradeTiers = [];
    if (gradeNum !== null) {
      for (let down = 1; down <= 3; down++) {
        const lowerGradeName = gradeNumToName.get(gradeNum - down);
        if (!lowerGradeName) continue;
        const candidates = claim(free.filter((k) => (teacherGrades.get(k) || new Set()).has(lowerGradeName)));
        lowerGradeTiers.push({ gradeName: lowerGradeName, candidates });
      }
    }

    const spaTeachers = claim(free.filter((k) => [...(teacherSubjects.get(k) || new Set())].some((s) => SPA_RE.test(s))));
    const peTeachers = claim(free.filter((k) => [...(teacherSubjects.get(k) || new Set())].some((s) => PE_RE.test(s))));
    const otherTeachers = claim(free);

    periodsOut.push({
      period_number: period,
      grade_name: grade,
      section_name: section,
      subject,
      sameGradeSameSubject,
      sameGradeOtherSubject,
      lowerGradeTiers,
      spaTeachers,
      peTeachers,
      otherTeachers,
    });
  }

  return periodsOut;
}
