"""Substitute-teacher suggestions for a specific date/teacher absence.

Two ways to get the "lessons" this runs against:
  - the live generated timetable (crud.get_all_lessons), for the normal case
  - a one-off uploaded timetable export (app/timetable_workbook.py's
    parse_generated_workbook()["lessons"]), for a coordinator who wants to
    compute suggestions against a timetable that hasn't been saved to the app
    yet - this is never written to the database, it only exists for the one
    /substitution/suggest request that used it.
"""

import re

# A candidate is bumped to the top tier if they teach DMT/Sports (in any of
# its usual spellings) to the exact same grade+section, even if that's not
# the period they're normally free.
DMT_SPORTS_KEYWORDS = ("dmt", "dance", "music", "theatre", "sport")


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def compute_suggestions(lessons, absent_teacher_name, day_of_week, all_teacher_names):
    """lessons: the whole week's placed lessons (from either source above).
    Returns a list of {period_number, grade_name, section_name, subject,
    suggestions: [{teacher_name, tier, tier_label, periods_today, periods_week}]}
    for every period the absent teacher has on day_of_week, ranked:
      1. DMT/Sports teacher for this exact grade+section, and free then
      2. Teacher of this exact subject for this exact grade+section, and free
      3. Any teacher of this grade (any section), and free
      4. Any other free teacher
    Within a tier, the least-loaded candidate (fewest periods that day, then
    fewest that week) is listed first - periods_today/periods_week are each
    candidate's EXISTING load (not counting the vacant period itself), so a
    coordinator can avoid stacking a substitution onto someone already full.
    """
    absent_key = _norm(absent_teacher_name)

    display_name = {_norm(n): n for n in all_teacher_names if n}
    for l in lessons:
        if l["teacher_name"]:
            display_name.setdefault(_norm(l["teacher_name"]), l["teacher_name"])

    occupied_period = {}       # teacher_key -> set(period_number) busy on day_of_week
    teacher_subjects = {}      # teacher_key -> set(subject, lowercased)
    teacher_grade_sections = {}  # teacher_key -> set((grade_name, section_name))
    teacher_grades = {}        # teacher_key -> set(grade_name)
    teacher_day_count = {}     # teacher_key -> periods already taught on day_of_week
    teacher_week_count = {}    # teacher_key -> periods already taught across the whole week

    for l in lessons:
        if not l["teacher_name"]:
            continue
        key = _norm(l["teacher_name"])
        teacher_subjects.setdefault(key, set()).add(_norm(l["subject"]))
        teacher_grade_sections.setdefault(key, set()).add((l["grade_name"], l["section_name"]))
        teacher_grades.setdefault(key, set()).add(l["grade_name"])
        teacher_week_count[key] = teacher_week_count.get(key, 0) + 1
        if l["day_of_week"] == day_of_week:
            occupied_period.setdefault(key, set()).add(l["period_number"])
            teacher_day_count[key] = teacher_day_count.get(key, 0) + 1

    absent_periods = sorted(
        (l for l in lessons if _norm(l["teacher_name"]) == absent_key and l["day_of_week"] == day_of_week),
        key=lambda l: l["period_number"],
    )

    all_keys = set(display_name.keys()) - {absent_key}

    def build(tier_keys, tier_num, label):
        return [
            {
                "teacher_name": display_name[k], "tier": tier_num, "tier_label": label,
                "periods_today": teacher_day_count.get(k, 0), "periods_week": teacher_week_count.get(k, 0),
            }
            for k in sorted(tier_keys, key=lambda k: (teacher_day_count.get(k, 0), teacher_week_count.get(k, 0), display_name[k]))
        ]

    periods_out = []
    for ap in absent_periods:
        period, grade, section, subject = ap["period_number"], ap["grade_name"], ap["section_name"], ap["subject"]
        subj_norm = _norm(subject)

        free = [k for k in all_keys if period not in occupied_period.get(k, set())]

        tier1, tier2, tier3, tier4 = [], [], [], []
        for k in free:
            subs = teacher_subjects.get(k, set())
            grade_sections = teacher_grade_sections.get(k, set())
            grades_taught = teacher_grades.get(k, set())
            is_dmt_sports = any(any(kw in s for kw in DMT_SPORTS_KEYWORDS) for s in subs)
            if is_dmt_sports and (grade, section) in grade_sections:
                tier1.append(k)
            elif subj_norm in subs and (grade, section) in grade_sections:
                tier2.append(k)
            elif grade in grades_taught:
                tier3.append(k)
            else:
                tier4.append(k)

        suggestions = (
            build(tier1, 1, "DMT/Sports teacher for this class") +
            build(tier2, 2, "Same subject teacher for this class") +
            build(tier3, 3, "Teaches this grade elsewhere") +
            build(tier4, 4, "Other free teacher")
        )

        periods_out.append({
            "period_number": period, "grade_name": grade, "section_name": section,
            "subject": subject, "suggestions": suggestions,
        })

    return periods_out
