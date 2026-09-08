// Port of Timetable/backend/app/rules.py. Parses rules.txt - the per-school
// scheduling constraints (block periods, fixed slots, placement priority)
// supplied as plain-English sentences at import time. Three sentence
// templates, one rule per line:
//
//   <Subject> is fixed on <Day> period <N> for grades <A> to <B>.
//   <Subject> is a block period for grades <A> to <B>.
//   <Subject> is shared across grades, schedule first.
//
// See the Python original's module docstring for the full explanation - this
// mirrors it 1:1, including DEFAULT_RULES_TEXT, so importing without a
// rules.txt keeps existing schools' generated timetables identical to before
// this became configurable.

const DAY_NAME_TO_INDEX = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };
const ORDINAL_TO_NUMBER = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3,
  fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6,
};

const GRADE_RANGE_RE = /grades?\s+(\d+)\s*(?:to|-|through)\s*(\d+)/i;
const GRADE_SINGLE_RE = /grades?\s+(\d+)\b/i;
const DAY_RE = /\b(monday|tuesday|wednesday|thursday|friday)\b/i;
const PERIOD_NUMBER_RE = /period\s+(\d+)/i;
const PERIOD_ORDINAL_RE = /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th)\s+period/i;
const BLOCK_SIZE_RE = /block\s+period\s+of\s+(\d+)/i;

const FIXED_TRIGGER_RE = /\b(?:is|are)\s+fixed\b/i;
const BLOCK_TRIGGER_RE = /\b(?:is|are)\s+(?:a\s+)?block\s+period\b/i;
const PRIORITY_TRIGGER_RE =
  /\b(?:is\s+shared\s+across\s+grades|is\s+a\s+shared\s+teacher\s+subject|is\s+a\s+priority\s+subject)\b/i;

export const DEFAULT_RULES_TEXT = `\
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
`;

function extractGradeRange(text) {
  let m = GRADE_RANGE_RE.exec(text);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  m = GRADE_SINGLE_RE.exec(text);
  if (m) {
    const n = parseInt(m[1], 10);
    return [n, n];
  }
  return null;
}

function extractDay(text) {
  const m = DAY_RE.exec(text);
  return m ? DAY_NAME_TO_INDEX[m[1].toLowerCase()] : null;
}

function extractPeriod(text) {
  let m = PERIOD_NUMBER_RE.exec(text);
  if (m) return parseInt(m[1], 10);
  m = PERIOD_ORDINAL_RE.exec(text);
  return m ? ORDINAL_TO_NUMBER[m[1].toLowerCase()] : null;
}

function extractSubject(text, triggerRe) {
  const m = triggerRe.exec(text);
  const subject = m ? text.slice(0, m.index) : text;
  return subject.trim().replace(/,+$/, "").trim();
}

// A subject phrase becomes a match pattern requiring every one of its words
// to appear as a substring of the real subject name.
function toPattern(subjectPhrase) {
  return subjectPhrase.split(/\s+/).filter(Boolean).join("+");
}

function matchesPattern(pattern, rawName) {
  const name = rawName.trim().toLowerCase();
  const parts = pattern.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => name.includes(p));
}

// Returns a list of rule objects. Throws with a line-numbered message on
// malformed input, so import-time validation surfaces a clear error instead
// of the rule silently never matching during generate().
export function parseRulesText(text) {
  const rules = [];
  const lines = (text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const clean = line.replace(/\.+$/, "").trim();

    try {
      if (BLOCK_TRIGGER_RE.test(clean)) {
        const subject = extractSubject(clean, BLOCK_TRIGGER_RE);
        const gradeRange = extractGradeRange(clean);
        if (!subject || !gradeRange) {
          throw new Error("expected '<Subject> is a block period for grades <A> to <B>'");
        }
        const blockSizeM = BLOCK_SIZE_RE.exec(clean);
        const blockSize = blockSizeM ? parseInt(blockSizeM[1], 10) : 2;
        rules.push({
          type: "block", pattern: toPattern(subject),
          grade_min: gradeRange[0], grade_max: gradeRange[1], block_size: blockSize,
        });
      } else if (FIXED_TRIGGER_RE.test(clean)) {
        const subject = extractSubject(clean, FIXED_TRIGGER_RE);
        const gradeRange = extractGradeRange(clean);
        const day = extractDay(clean);
        const period = extractPeriod(clean);
        if (!subject || !gradeRange || day === null || period === null) {
          throw new Error("expected '<Subject> is fixed on <Day> period <N> for grades <A> to <B>'");
        }
        rules.push({
          type: "fixed", pattern: toPattern(subject),
          grade_min: gradeRange[0], grade_max: gradeRange[1], day, period,
        });
      } else if (PRIORITY_TRIGGER_RE.test(clean)) {
        const subject = extractSubject(clean, PRIORITY_TRIGGER_RE);
        if (!subject) {
          throw new Error(
            "expected '<Subject> is shared across grades, schedule first' or '<Subject> is a priority subject'"
          );
        }
        rules.push({ type: "priority", pattern: toPattern(subject) });
      } else {
        throw new Error(
          "didn't recognize this as a fixed-slot, block-period, or shared-teacher rule - " +
            "see the format examples on the Import tab"
        );
      }
    } catch (exc) {
      throw new Error(`rules.txt line ${lineNum}: '${rawLine}' - ${exc.message}`);
    }
  }
  return rules;
}

// rulesText may be null/blank (no rules.txt supplied) - falls back to
// DEFAULT_RULES_TEXT so existing schools' schedules are unaffected.
export function loadRules(rulesText) {
  const text = rulesText && rulesText.trim() ? rulesText : DEFAULT_RULES_TEXT;
  return parseRulesText(text);
}

// Returns {blockSize, fixedDay, fixedPeriod} for a subject - the shape
// scheduler.js's placement logic expects. First matching rule wins.
export function subjectRulesFor(rules, rawName, gradeOrderIndex) {
  for (const r of rules) {
    if (r.type !== "fixed" && r.type !== "block") continue;
    if (!(r.grade_min <= gradeOrderIndex && gradeOrderIndex <= r.grade_max)) continue;
    if (!matchesPattern(r.pattern, rawName)) continue;
    if (r.type === "fixed") {
      return { blockSize: null, fixedDay: r.day, fixedPeriod: r.period };
    }
    return { blockSize: r.block_size, fixedDay: null, fixedPeriod: null };
  }
  return { blockSize: null, fixedDay: null, fixedPeriod: null };
}

export function isPrioritySubject(rules, rawName) {
  return rules.some((r) => r.type === "priority" && matchesPattern(r.pattern, rawName));
}
