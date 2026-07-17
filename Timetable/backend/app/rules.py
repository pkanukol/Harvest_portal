"""Parses rules.txt - the per-school scheduling constraints (block periods,
fixed slots, placement priority) that used to be hardcoded in scheduler.py.
Every school's real timetable has its own set of these, so they're supplied
as plain English sentences at import time instead of requiring a code change
per school. There's no rigid symbol-heavy syntax - just three sentence
templates, one rule per line:

  <Subject> is fixed on <Day> period <N> for grades <A> to <B>.
      e.g. "Assembly is fixed on Monday period 1 for grades 1 to 5."

  <Subject> is a block period for grades <A> to <B>.
      e.g. "Computer Science is a block period for grades 1 to 10."
      (a block period is 2 consecutive periods on the same day; write
      "...a block period of 3 periods..." to change the size)

  <Subject> is shared across grades, schedule first.
      e.g. "Yoga is shared across grades, schedule first."
      (use this for a subject taught by only one or two specialists across
      many grades, so it gets first pick of the week before it runs out of
      free periods - also accepts "... is a priority subject.")

Grades can also be a single number ("grade 3"). Day names and "first/1st"
style period wording are both understood. Lines starting with # are ignored.
Subject names don't need to match a workbook subject exactly - a rule matches
if every word in the subject phrase appears somewhere in the real subject
name (case-insensitive), so "Dance Music" matches "Dance/ Music/Theatre".
"""

import re

DAY_NAME_TO_INDEX = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4}
ORDINAL_TO_NUMBER = {
    "first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3,
    "fourth": 4, "4th": 4, "fifth": 5, "5th": 5, "sixth": 6, "6th": 6,
}

_GRADE_RANGE_RE = re.compile(r"grades?\s+(\d+)\s*(?:to|-|through)\s*(\d+)", re.IGNORECASE)
_GRADE_SINGLE_RE = re.compile(r"grades?\s+(\d+)\b", re.IGNORECASE)
_DAY_RE = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday)\b", re.IGNORECASE)
_PERIOD_NUMBER_RE = re.compile(r"period\s+(\d+)", re.IGNORECASE)
_PERIOD_ORDINAL_RE = re.compile(r"\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th)\s+period", re.IGNORECASE)
_BLOCK_SIZE_RE = re.compile(r"block\s+period\s+of\s+(\d+)", re.IGNORECASE)

_FIXED_TRIGGER_RE = re.compile(r"\b(?:is|are)\s+fixed\b", re.IGNORECASE)
_BLOCK_TRIGGER_RE = re.compile(r"\b(?:is|are)\s+(?:a\s+)?block\s+period\b", re.IGNORECASE)
_PRIORITY_TRIGGER_RE = re.compile(
    r"\b(?:is\s+shared\s+across\s+grades|is\s+a\s+shared\s+teacher\s+subject|is\s+a\s+priority\s+subject)\b",
    re.IGNORECASE,
)

# Matches exactly what was previously hardcoded in scheduler.py, so importing
# without a rules.txt (or leaving it blank) keeps existing schools' generated
# timetables identical to before this became configurable.
DEFAULT_RULES_TEXT = """\
# Fixed slots - subject always goes at this exact day/period, every week.
Assembly is fixed on Monday period 1 for grades 1 to 5.
Assembly is fixed on Wednesday period 1 for grades 6 to 8.
Assembly is fixed on Friday period 1 for grades 9 to 10.

# Block periods - 2 consecutive periods on the same day (a break in between is fine).
Computer Science is a block period for grades 1 to 10.
Math is a block period for grades 6 to 10.
Physics is a block period for grades 6 to 8.
EVS is a block period for grades 1 to 5.
Dance Music is a block period for grades 1 to 5.

# Shared-teacher subjects - scheduled first, before even block subjects,
# since their teachers run out of free periods fastest otherwise.
Yoga is shared across grades, schedule first.
Library is shared across grades, schedule first.
LIB is shared across grades, schedule first.
"""


def _extract_grade_range(text):
    m = _GRADE_RANGE_RE.search(text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = _GRADE_SINGLE_RE.search(text)
    if m:
        n = int(m.group(1))
        return n, n
    return None


def _extract_day(text):
    m = _DAY_RE.search(text)
    return DAY_NAME_TO_INDEX[m.group(1).lower()] if m else None


def _extract_period(text):
    m = _PERIOD_NUMBER_RE.search(text)
    if m:
        return int(m.group(1))
    m = _PERIOD_ORDINAL_RE.search(text)
    return ORDINAL_TO_NUMBER[m.group(1).lower()] if m else None


def _extract_subject(text, trigger_re):
    m = trigger_re.search(text)
    subject = text[:m.start()] if m else text
    return subject.strip().rstrip(",").strip()


def _to_pattern(subject_phrase):
    """A subject phrase becomes a match pattern requiring every one of its
    words to appear as a substring of the real subject name - reuses the
    same "+"-joined AND semantics _matches_pattern already implements."""
    return "+".join(w for w in subject_phrase.split() if w)


def _matches_pattern(pattern, raw_name):
    name = raw_name.strip().lower()
    parts = [p.strip().lower() for p in pattern.split("+") if p.strip()]
    return bool(parts) and all(p in name for p in parts)


def parse_rules_text(text):
    """Returns a list of rule dicts. Raises ValueError with a line-numbered
    message on malformed input, so import-time validation surfaces a clear
    error instead of the rule silently never matching during generate()."""
    rules = []
    for line_num, raw_line in enumerate((text or "").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        clean = line.rstrip(".").strip()
        try:
            if _BLOCK_TRIGGER_RE.search(clean):
                subject = _extract_subject(clean, _BLOCK_TRIGGER_RE)
                grade_range = _extract_grade_range(clean)
                if not subject or not grade_range:
                    raise ValueError(
                        "expected '<Subject> is a block period for grades <A> to <B>'"
                    )
                block_size_m = _BLOCK_SIZE_RE.search(clean)
                block_size = int(block_size_m.group(1)) if block_size_m else 2
                rules.append({
                    "type": "block", "pattern": _to_pattern(subject),
                    "grade_min": grade_range[0], "grade_max": grade_range[1], "block_size": block_size,
                })
            elif _FIXED_TRIGGER_RE.search(clean):
                subject = _extract_subject(clean, _FIXED_TRIGGER_RE)
                grade_range = _extract_grade_range(clean)
                day = _extract_day(clean)
                period = _extract_period(clean)
                if not subject or not grade_range or day is None or period is None:
                    raise ValueError(
                        "expected '<Subject> is fixed on <Day> period <N> for grades <A> to <B>'"
                    )
                rules.append({
                    "type": "fixed", "pattern": _to_pattern(subject),
                    "grade_min": grade_range[0], "grade_max": grade_range[1], "day": day, "period": period,
                })
            elif _PRIORITY_TRIGGER_RE.search(clean):
                subject = _extract_subject(clean, _PRIORITY_TRIGGER_RE)
                if not subject:
                    raise ValueError(
                        "expected '<Subject> is shared across grades, schedule first' "
                        "or '<Subject> is a priority subject'"
                    )
                rules.append({"type": "priority", "pattern": _to_pattern(subject)})
            else:
                raise ValueError(
                    "didn't recognize this as a fixed-slot, block-period, or shared-teacher rule - "
                    "see the format examples on the Import tab"
                )
        except ValueError as exc:
            raise ValueError(f"rules.txt line {line_num}: {raw_line!r} - {exc}")
    return rules


def load_rules(rules_text):
    """rules_text may be None/blank (no rules.txt supplied) - falls back to
    DEFAULT_RULES_TEXT so existing schools' schedules are unaffected."""
    text = rules_text if rules_text and rules_text.strip() else DEFAULT_RULES_TEXT
    return parse_rules_text(text)


def subject_rules_for(rules, raw_name, grade_order_index):
    """Returns {block_size, fixed_day, fixed_period} for a subject - the shape
    scheduler.py's placement logic expects. First matching rule wins."""
    for r in rules:
        if r["type"] not in ("fixed", "block"):
            continue
        if not (r["grade_min"] <= grade_order_index <= r["grade_max"]):
            continue
        if not _matches_pattern(r["pattern"], raw_name):
            continue
        if r["type"] == "fixed":
            return {"block_size": None, "fixed_day": r["day"], "fixed_period": r["period"]}
        return {"block_size": r["block_size"], "fixed_day": None, "fixed_period": None}
    return {"block_size": None, "fixed_day": None, "fixed_period": None}


def is_priority_subject(rules, raw_name):
    return any(r["type"] == "priority" and _matches_pattern(r["pattern"], raw_name) for r in rules)
