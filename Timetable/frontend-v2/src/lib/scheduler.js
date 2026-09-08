import { loadRules, subjectRulesFor, isPrioritySubject } from "./rules.js";

// Port of Timetable/backend/app/scheduler.py - constrained greedy timetable
// placer (not a full ILP solver - see the migration plan doc).
//
// Structural difference from the Python original, unavoidable since there's
// no DB session here: the Python generate()/generate_selected() both wipe
// non-manual slots and commit new ones inline via SQLAlchemy. Here, the
// caller fetches gradeSubjectPeriods/sections/sectionSubjectTeachers/
// existingSlots via Supabase first (existingSlots should already reflect
// whatever wipe the caller intends - e.g. exclude is_manual_override=false
// rows for a full regenerate), calls generate()/generateSelected() to get
// back {placedCount, newSlots}, then commits newSlots atomically via the
// apply_generated_slots RPC. Every constraint-satisfaction rule below is a
// faithful 1:1 port; only the DB wiring moved to the caller.
//
// existingSlots rows need a joined section_subject_teacher.grade_subject_period_id
// (Supabase embedded select) - same relationship traversal the Python
// version does via slot.section_subject_teacher.grade_subject_period_id.
//
// Placement uses real randomness (Math.random(), same as Python's
// random.shuffle) to explore day/period order - like the Python original,
// re-running this on the same input can place things differently even
// though both are equally "correct" (any valid slot satisfying every
// constraint is acceptable). Parity testing for this file verifies the
// constraint logic itself (fixed slots land exactly where specified, block
// subjects get contiguous periods, no teacher/section is ever double-booked)
// rather than diffing exact output, since Python is just as non-deterministic
// run-to-run.

const DAYS = [0, 1, 2, 3, 4]; // 0=Mon .. 4=Fri

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRequirements(gradeSubjectPeriods, sections, sectionSubjectTeachers, existingSlots, parsedRules) {
  const placedSstCounts = new Map();
  for (const slot of existingSlots) {
    if (slot.section_subject_teacher_id) {
      placedSstCounts.set(
        slot.section_subject_teacher_id,
        (placedSstCounts.get(slot.section_subject_teacher_id) || 0) + 1
      );
    }
  }

  const sectionsByGrade = new Map();
  for (const s of sections) {
    if (!sectionsByGrade.has(s.grade_id)) sectionsByGrade.set(s.grade_id, []);
    sectionsByGrade.get(s.grade_id).push(s);
  }

  const sstsBySectionGsp = new Map();
  for (const sst of sectionSubjectTeachers) {
    const key = `${sst.section_id}|${sst.grade_subject_period_id}`;
    if (!sstsBySectionGsp.has(key)) sstsBySectionGsp.set(key, []);
    sstsBySectionGsp.get(key).push(sst);
  }

  const requirements = [];
  for (const gsp of gradeSubjectPeriods) {
    const gradeSections = sectionsByGrade.get(gsp.grade_id) || [];
    const subjRules = subjectRulesFor(parsedRules, gsp.subject.raw_name, gsp.grade.order_index);
    for (const section of gradeSections) {
      const ssts = sstsBySectionGsp.get(`${section.id}|${gsp.id}`) || [];
      if (!ssts.length) continue;
      const components = ssts.map((s) => ({ sst_id: s.id, teacher_id: s.teacher_id }));
      // A parallel group is placed as one unit each period; it's "already
      // placed N times" if any one of its components has N existing slots.
      const alreadyPlaced = Math.max(0, ...components.map((c) => placedSstCounts.get(c.sst_id) || 0));
      const remaining = gsp.periods_per_week - alreadyPlaced;
      if (remaining <= 0) continue;
      requirements.push({
        section_id: section.id,
        gsp_id: gsp.id,
        components,
        teacher_ids: components.filter((c) => c.teacher_id).map((c) => c.teacher_id),
        remaining,
        subject_name: gsp.subject.raw_name,
        grade_name: gsp.grade.name,
        section_name: section.name,
        block_size: subjRules.blockSize,
        fixed_day: subjRules.fixedDay,
        fixed_period: subjRules.fixedPeriod,
      });
    }
  }

  // Most-constrained-first: needs more periods and/or more distinct teachers
  // (harder to fit everyone free at once) get placed before easier ones;
  // subjects with no teacher at all (unconstrained) sort to the back.
  requirements.sort((a, b) => {
    if (b.teacher_ids.length !== a.teacher_ids.length) return b.teacher_ids.length - a.teacher_ids.length;
    return b.remaining - a.remaining;
  });
  return requirements;
}

function findSlot(req, periodsPerDay, sectionOccupancy, teacherOccupancy, sectionSubjectToday, avoidSameDay) {
  for (const day of shuffled(DAYS)) {
    if (avoidSameDay && sectionSubjectToday.get(`${req.section_id}|${day}`)?.has(req.gsp_id)) continue;
    const periods = shuffled(Array.from({ length: periodsPerDay }, (_, i) => i + 1));
    for (const period of periods) {
      if (sectionOccupancy.has(`${req.section_id}|${day}|${period}`)) continue;
      if (req.teacher_ids.some((t) => teacherOccupancy.has(`${t}|${day}|${period}`))) continue;
      return [day, period];
    }
  }
  return null;
}

// A block is blockSize consecutive period NUMBERS on the same day (a break
// in wall-clock time in between is fine - periods are numbered ignoring
// breaks already).
function findBlock(req, blockSize, periodsPerDay, sectionOccupancy, teacherOccupancy, sectionSubjectToday, avoidSameDay) {
  const maxStart = periodsPerDay - blockSize + 1;
  if (maxStart < 1) return null;
  for (const day of shuffled(DAYS)) {
    if (avoidSameDay && sectionSubjectToday.get(`${req.section_id}|${day}`)?.has(req.gsp_id)) continue;
    const starts = shuffled(Array.from({ length: maxStart }, (_, i) => i + 1));
    for (const start of starts) {
      const periods = Array.from({ length: blockSize }, (_, i) => start + i);
      if (periods.some((p) => sectionOccupancy.has(`${req.section_id}|${day}|${p}`))) continue;
      if (periods.some((p) => req.teacher_ids.some((t) => teacherOccupancy.has(`${t}|${day}|${p}`)))) continue;
      return [day, periods];
    }
  }
  return null;
}

function buildOccupancy(existingSlots) {
  const sectionOccupancy = new Set();
  const teacherOccupancy = new Set();
  const sectionSubjectToday = new Map();
  for (const slot of existingSlots) {
    sectionOccupancy.add(`${slot.section_id}|${slot.day_of_week}|${slot.period_number}`);
    if (slot.teacher_id) {
      teacherOccupancy.add(`${slot.teacher_id}|${slot.day_of_week}|${slot.period_number}`);
    }
    if (slot.section_subject_teacher_id) {
      const gspId = slot.section_subject_teacher.grade_subject_period_id;
      const key = `${slot.section_id}|${slot.day_of_week}`;
      if (!sectionSubjectToday.has(key)) sectionSubjectToday.set(key, new Set());
      sectionSubjectToday.get(key).add(gspId);
    }
  }
  return { sectionOccupancy, teacherOccupancy, sectionSubjectToday };
}

// Places every requirement passed in, appending new (unsaved) slot objects to
// `newSlots` and returning how many periods got placed. Never touches
// anything outside the given occupancy sets, so callers control exactly what
// was eligible to be wiped/replaced. markManual=true flags the new slots as
// is_manual_override so a later regenerate never silently wipes a
// deliberate, one-off gap fix.
function placeRequirements(
  academicYearId, requirements, periodsPerDay,
  sectionOccupancy, teacherOccupancy, sectionSubjectToday, newSlots, parsedRules,
  markManual = false
) {
  let placedCount = 0;

  function place(req, day, period) {
    sectionOccupancy.add(`${req.section_id}|${day}|${period}`);
    const key = `${req.section_id}|${day}`;
    if (!sectionSubjectToday.has(key)) sectionSubjectToday.set(key, new Set());
    sectionSubjectToday.get(key).add(req.gsp_id);
    for (const comp of req.components) {
      if (comp.teacher_id) teacherOccupancy.add(`${comp.teacher_id}|${day}|${period}`);
      newSlots.push({
        academic_year_id: academicYearId,
        section_id: req.section_id,
        day_of_week: day,
        period_number: period,
        section_subject_teacher_id: comp.sst_id,
        teacher_id: comp.teacher_id,
        is_manual_override: markManual,
      });
    }
    placedCount += 1;
  }

  // Order matters here, independent of the most-constrained-first sort in
  // buildRequirements: fixed slots have zero flexibility so they must claim
  // their exact slot first. Priority subjects go next - each taught by a
  // couple of specialists shared across many grades, so if the rest of the
  // week fills in before them, those teachers often have nowhere left to fit
  // every section. Block subjects need two *adjacent* free periods, which
  // gets much harder to find once the week is fragmented by single-period
  // placements, so they go next, before ordinary single-period subjects
  // regardless of teacher count.
  const fixedReqs = requirements.filter((r) => r.fixed_day !== null);
  const rest = requirements.filter((r) => r.fixed_day === null);
  const priorityReqs = rest.filter((r) => isPrioritySubject(parsedRules, r.subject_name));
  const priorityIds = new Set(priorityReqs);
  const blockReqs = rest.filter((r) => r.block_size && !priorityIds.has(r));
  const normalReqs = rest.filter((r) => !r.block_size && !priorityIds.has(r));

  function placeSingles(req, remaining) {
    for (let i = 0; i < remaining; i++) {
      let found = findSlot(req, periodsPerDay, sectionOccupancy, teacherOccupancy, sectionSubjectToday, true);
      if (!found) found = findSlot(req, periodsPerDay, sectionOccupancy, teacherOccupancy, sectionSubjectToday, false);
      if (!found) continue; // left as a gap; gaps.js reports it live, with a suggestion
      const [day, period] = found;
      place(req, day, period);
    }
  }

  for (const req of fixedReqs) {
    const day = req.fixed_day;
    const period = req.fixed_period;
    for (let i = 0; i < req.remaining; i++) {
      if (sectionOccupancy.has(`${req.section_id}|${day}|${period}`)) break; // already taken - falls to gaps
      if (req.teacher_ids.some((t) => teacherOccupancy.has(`${t}|${day}|${period}`))) break;
      place(req, day, period);
      break; // a fixed slot can only ever hold one period of this subject
    }
  }

  for (const req of priorityReqs) placeSingles(req, req.remaining);

  for (const req of blockReqs) {
    let remaining = req.remaining;
    const blockSize = req.block_size;
    if (remaining >= blockSize) {
      let found = findBlock(req, blockSize, periodsPerDay, sectionOccupancy, teacherOccupancy, sectionSubjectToday, true);
      if (!found) found = findBlock(req, blockSize, periodsPerDay, sectionOccupancy, teacherOccupancy, sectionSubjectToday, false);
      if (found) {
        const [day, periods] = found;
        for (const period of periods) place(req, day, period);
        remaining -= blockSize;
      }
      // if no block fits anywhere, fall through and place everything as
      // ordinary single periods instead of leaving it entirely unplaced
    }
    placeSingles(req, remaining);
  }

  for (const req of normalReqs) placeSingles(req, req.remaining);

  return placedCount;
}

// sectionIds=null regenerates the whole academic year (default); a list
// scopes the refill to just those sections. existingSlots should already
// reflect whatever the caller intends to keep (e.g. only manual-override
// slots, for a full regenerate) - occupancy for conflict-checking is built
// from all of existingSlots regardless, since a teacher in an untouched
// section can still block a placement in a scoped one.
export function generate({
  academicYearId, sectionIds = null, rulesText, periodsPerDay = 8,
  gradeSubjectPeriods, sections, sectionSubjectTeachers, existingSlots,
}) {
  const parsedRules = loadRules(rulesText);
  const { sectionOccupancy, teacherOccupancy, sectionSubjectToday } = buildOccupancy(existingSlots);

  let requirements = buildRequirements(gradeSubjectPeriods, sections, sectionSubjectTeachers, existingSlots, parsedRules);
  if (sectionIds !== null) {
    const sectionIdSet = new Set(sectionIds);
    requirements = requirements.filter((r) => sectionIdSet.has(r.section_id));
  }

  const newSlots = [];
  const placedCount = placeRequirements(
    academicYearId, requirements, periodsPerDay,
    sectionOccupancy, teacherOccupancy, sectionSubjectToday, newSlots, parsedRules
  );

  return { placedCount, newSlots };
}

// Fills in ONLY the specific (sectionId, gspId) gaps in `targets` - e.g. a
// subset of checkboxes the user picked from the gaps list. Nothing is wiped:
// existingSlots should reflect every current slot (auto-generated or
// manual), and this only adds the missing periods for the chosen gaps.
export function generateSelected({
  academicYearId, targets, rulesText, periodsPerDay = 8,
  gradeSubjectPeriods, sections, sectionSubjectTeachers, existingSlots,
}) {
  const parsedRules = loadRules(rulesText);
  const { sectionOccupancy, teacherOccupancy, sectionSubjectToday } = buildOccupancy(existingSlots);

  const targetSet = new Set(targets.map(([sectionId, gspId]) => `${sectionId}|${gspId}`));
  let requirements = buildRequirements(gradeSubjectPeriods, sections, sectionSubjectTeachers, existingSlots, parsedRules);
  requirements = requirements.filter((r) => targetSet.has(`${r.section_id}|${r.gsp_id}`));

  const newSlots = [];
  const placedCount = placeRequirements(
    academicYearId, requirements, periodsPerDay,
    sectionOccupancy, teacherOccupancy, sectionSubjectToday, newSlots, parsedRules,
    true
  );

  return { placedCount, newSlots };
}
