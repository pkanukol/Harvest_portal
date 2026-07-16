"""Parses rules.txt - the per-school scheduling constraints (block periods,
fixed slots, placement priority) that used to be hardcoded in scheduler.py.
Every school's real timetable has its own set of these (which subjects need a
double period, which are pinned to a fixed day, which teachers are shared
thinly enough to need first pick of the week), so they're supplied as a plain
text file at import time instead of requiring a code change per school.

Format (blank lines and #-comments ignored):
    FIXED <pattern> | <grade-range> | <day-name> | <period-number>
    BLOCK <pattern> | <grade-range> | <block-size>
    PRIORITY <pattern>

<pattern> matches a subject's raw name, case-insensitively:
  - "=exact text"   requires the WHOLE name to equal "exact text"
  - "word1+word2"   requires ALL of word1, word2, ... to appear as substrings
  - anything else   is a plain substring match

<grade-range> is "N" or "N-M" (inclusive), matched against the grade's order_index.
<day-name> is monday/tuesday/wednesday/thursday/friday (case-insensitive).
"""

DAY_NAME_TO_INDEX = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4}

# Matches exactly what was previously hardcoded in scheduler.py, so importing
# without a rules.txt (or leaving it blank) keeps existing schools' generated
# timetables byte-for-byte identical to before this became configurable.
DEFAULT_RULES_TEXT = """\
# Fixed slots: subject always goes at this exact day/period, every week.
FIXED assembly | 1-5 | monday | 1
FIXED assembly | 6-8 | wednesday | 1
FIXED assembly | 9-10 | friday | 1

# Block periods: 2 consecutive periods on the same day (a break in between is fine).
BLOCK computer science | 1-10 | 2
BLOCK =math | 6-10 | 2
BLOCK =physics | 6-8 | 2
BLOCK =evs | 1-5 | 2
BLOCK dance+music | 1-5 | 2

# Priority subjects: placed first, even before block subjects - use this for
# subjects taught by only one or two specialists shared across many grades,
# since they run out of free periods fastest if the rest of the week fills in first.
PRIORITY yoga
PRIORITY =lib
PRIORITY library
"""


def _parse_grade_range(text):
    text = text.strip()
    if "-" in text:
        lo, hi = text.split("-", 1)
        return int(lo), int(hi)
    n = int(text)
    return n, n


def _matches_pattern(pattern, raw_name):
    pattern = pattern.strip()
    name = raw_name.strip().lower()
    if pattern.startswith("="):
        return name == pattern[1:].strip().lower()
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
        try:
            keyword, _, rest = line.partition(" ")
            keyword = keyword.strip().upper()
            if keyword == "FIXED":
                pattern, grade_range, day_name, period = [p.strip() for p in rest.split("|")]
                grade_min, grade_max = _parse_grade_range(grade_range)
                day = DAY_NAME_TO_INDEX[day_name.strip().lower()]
                rules.append({
                    "type": "fixed", "pattern": pattern, "grade_min": grade_min, "grade_max": grade_max,
                    "day": day, "period": int(period),
                })
            elif keyword == "BLOCK":
                pattern, grade_range, block_size = [p.strip() for p in rest.split("|")]
                grade_min, grade_max = _parse_grade_range(grade_range)
                rules.append({
                    "type": "block", "pattern": pattern, "grade_min": grade_min, "grade_max": grade_max,
                    "block_size": int(block_size),
                })
            elif keyword == "PRIORITY":
                rules.append({"type": "priority", "pattern": rest.strip()})
            else:
                raise ValueError(f"unknown rule type '{keyword}' (expected FIXED, BLOCK, or PRIORITY)")
        except Exception as exc:
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
