"""Constrained greedy timetable placer (not a full ILP solver - see plan doc).

Existing manually-edited slots (is_manual_override=True) are treated as fixed
and never touched; a "generate" run wipes and replaces only the previous
auto-generated slots, so it can be re-run after manual fixes without undoing
them.
"""
import random
from sqlalchemy.orm import Session
from . import models

DAYS = [0, 1, 2, 3, 4]  # 0=Mon .. 4=Fri


def _subject_rules(raw_name: str, grade_order_index: int):
    """A handful of school-specific scheduling rules, keyed by matching the
    subject's raw name (case-insensitive) and the grade. block_size means
    "place this many periods as one consecutive block on the same day
    (adjacent period numbers - a break in between is fine), then place
    whatever's left over as ordinary single periods". fixed_day/fixed_period
    means "this subject always goes at this exact slot, not wherever's free"."""
    name = raw_name.strip().lower()

    if "assembly" in name:
        # Monday period 1 for grades 1-5, Wednesday period 1 for grades 6-8,
        # Friday period 1 for grades 9-10.
        if grade_order_index <= 5:
            day = 0
        elif grade_order_index <= 8:
            day = 2
        else:
            day = 4
        return {"block_size": None, "fixed_day": day, "fixed_period": 1}

    if "computer science" in name:  # block for every grade (9-10's 3rd period
        # falls to place_singles(), which naturally avoids the block's day)
        return {"block_size": 2, "fixed_day": None, "fixed_period": None}

    if 6 <= grade_order_index <= 10 and name == "math":
        return {"block_size": 2, "fixed_day": None, "fixed_period": None}

    if 6 <= grade_order_index <= 8 and name == "physics":
        # The Physics/Biology/Chemistry split (see excel_import / commit_import
        # migration) always gives the block to Physics - the same one teacher
        # covers all three disciplines per section, so which one gets the
        # block doesn't affect teacher availability either way.
        return {"block_size": 2, "fixed_day": None, "fixed_period": None}

    if grade_order_index <= 5:
        if name == "evs":
            return {"block_size": 2, "fixed_day": None, "fixed_period": None}
        if "dance" in name and "music" in name:  # the combined Dance/Music/Theatre subject
            return {"block_size": 2, "fixed_day": None, "fixed_period": None}

    return {"block_size": None, "fixed_day": None, "fixed_period": None}


def _build_requirements(db: Session, academic_year_id: int, existing_slots):
    placed_sst_counts = {}
    for slot in existing_slots:
        if slot.section_subject_teacher_id:
            placed_sst_counts[slot.section_subject_teacher_id] = placed_sst_counts.get(slot.section_subject_teacher_id, 0) + 1

    requirements = []
    gsps = db.query(models.GradeSubjectPeriod).filter(
        models.GradeSubjectPeriod.academic_year_id == academic_year_id,
    ).all()
    for gsp in gsps:
        sections = db.query(models.Section).filter(models.Section.grade_id == gsp.grade_id).all()
        rules = _subject_rules(gsp.subject.raw_name, gsp.grade.order_index)
        for section in sections:
            ssts = db.query(models.SectionSubjectTeacher).filter(
                models.SectionSubjectTeacher.section_id == section.id,
                models.SectionSubjectTeacher.grade_subject_period_id == gsp.id,
            ).all()
            if not ssts:
                continue
            components = [{"sst_id": s.id, "teacher_id": s.teacher_id} for s in ssts]
            # A parallel group is placed as one unit each period; it's "already
            # placed N times" if any one of its components has N existing slots.
            already_placed = max((placed_sst_counts.get(c["sst_id"], 0) for c in components), default=0)
            remaining = gsp.periods_per_week - already_placed
            if remaining <= 0:
                continue
            requirements.append({
                "section_id": section.id,
                "gsp_id": gsp.id,
                "components": components,
                "teacher_ids": [c["teacher_id"] for c in components if c["teacher_id"]],
                "remaining": remaining,
                "subject_name": gsp.subject.raw_name,
                "grade_name": gsp.grade.name,
                "section_name": section.name,
                "block_size": rules["block_size"],
                "fixed_day": rules["fixed_day"],
                "fixed_period": rules["fixed_period"],
            })

    # Most-constrained-first: needs more periods and/or more distinct teachers
    # (harder to fit everyone free at once) get placed before easier ones;
    # subjects with no teacher at all (unconstrained) sort to the back.
    requirements.sort(key=lambda r: (len(r["teacher_ids"]), r["remaining"]), reverse=True)
    return requirements


def _find_slot(req, periods_per_day, section_occupancy, teacher_occupancy, section_subject_today, avoid_same_day):
    days = DAYS[:]
    random.shuffle(days)
    for day in days:
        if avoid_same_day and req["gsp_id"] in section_subject_today.get((req["section_id"], day), set()):
            continue
        periods = list(range(1, periods_per_day + 1))
        random.shuffle(periods)
        for period in periods:
            if (req["section_id"], day, period) in section_occupancy:
                continue
            if any((t, day, period) in teacher_occupancy for t in req["teacher_ids"]):
                continue
            return day, period
    return None


def _find_block(req, block_size, periods_per_day, section_occupancy, teacher_occupancy, section_subject_today, avoid_same_day):
    """A block is `block_size` consecutive period NUMBERS on the same day (a
    break in wall-clock time in between is fine - periods are numbered
    ignoring breaks already)."""
    days = DAYS[:]
    random.shuffle(days)
    for day in days:
        if avoid_same_day and req["gsp_id"] in section_subject_today.get((req["section_id"], day), set()):
            continue
        starts = list(range(1, periods_per_day - block_size + 2))
        random.shuffle(starts)
        for start in starts:
            periods = list(range(start, start + block_size))
            if any((req["section_id"], day, p) in section_occupancy for p in periods):
                continue
            if any((t, day, p) in teacher_occupancy for t in req["teacher_ids"] for p in periods):
                continue
            return day, periods
    return None


def _is_priority_shared_subject(raw_name: str) -> bool:
    name = raw_name.strip().lower()
    return "yoga" in name or name == "lib" or "library" in name


def _build_occupancy(existing_slots):
    section_occupancy = set()
    teacher_occupancy = set()
    section_subject_today = {}
    for slot in existing_slots:
        section_occupancy.add((slot.section_id, slot.day_of_week, slot.period_number))
        if slot.teacher_id:
            teacher_occupancy.add((slot.teacher_id, slot.day_of_week, slot.period_number))
        if slot.section_subject_teacher_id:
            gsp_id = slot.section_subject_teacher.grade_subject_period_id
            section_subject_today.setdefault((slot.section_id, slot.day_of_week), set()).add(gsp_id)
    return section_occupancy, teacher_occupancy, section_subject_today


def _place_requirements(academic_year_id, requirements, periods_per_day, section_occupancy, teacher_occupancy, section_subject_today, new_slots, mark_manual=False):
    """Places every requirement passed in, appending new (unsaved) TimetableSlot
    rows to `new_slots` and returns how many periods got placed. Never touches
    anything outside the given occupancy sets, so callers control exactly
    what's eligible to be wiped/replaced (a full regenerate wipes first; a
    "fix this gap" call passes in occupancy built from the untouched DB).
    mark_manual=True flags the new slots as is_manual_override so a later
    regenerate never silently wipes a deliberate, one-off gap fix."""
    placed_count = 0

    def place(req, day, period):
        nonlocal placed_count
        section_occupancy.add((req["section_id"], day, period))
        section_subject_today.setdefault((req["section_id"], day), set()).add(req["gsp_id"])
        for comp in req["components"]:
            if comp["teacher_id"]:
                teacher_occupancy.add((comp["teacher_id"], day, period))
            new_slots.append(models.TimetableSlot(
                academic_year_id=academic_year_id,
                section_id=req["section_id"],
                day_of_week=day,
                period_number=period,
                section_subject_teacher_id=comp["sst_id"],
                teacher_id=comp["teacher_id"],
                is_manual_override=mark_manual,
            ))
        placed_count += 1

    # Order matters here, independent of the most-constrained-first sort in
    # _build_requirements: fixed slots have zero flexibility so they must
    # claim their exact slot first. Yoga and Library go next - they're each
    # taught by a couple of specialists shared across many grades (1-5 and
    # 6-8), so if the rest of the week fills in before them, those teachers
    # often have nowhere left to fit every section. Block subjects need two
    # *adjacent* free periods, which gets much harder to find once the week
    # is fragmented by single-period placements, so they go next, before
    # ordinary single-period subjects regardless of teacher count (a
    # 1-teacher block subject would otherwise sort last and reliably fail to
    # find room for its block).
    fixed_reqs = [r for r in requirements if r["fixed_day"] is not None]
    rest = [r for r in requirements if r["fixed_day"] is None]
    priority_reqs = [r for r in rest if _is_priority_shared_subject(r["subject_name"])]
    priority_ids = {id(r) for r in priority_reqs}
    block_reqs = [r for r in rest if r["block_size"] and id(r) not in priority_ids]
    normal_reqs = [r for r in rest if not r["block_size"] and id(r) not in priority_ids]

    def place_singles(req, remaining):
        for _ in range(remaining):
            found = _find_slot(req, periods_per_day, section_occupancy, teacher_occupancy, section_subject_today, avoid_same_day=True)
            if not found:
                found = _find_slot(req, periods_per_day, section_occupancy, teacher_occupancy, section_subject_today, avoid_same_day=False)
            if not found:
                continue  # left as a gap; crud.get_gaps() reports it live, with a suggestion
            day, period = found
            place(req, day, period)

    for req in fixed_reqs:
        day, period = req["fixed_day"], req["fixed_period"]
        for _ in range(req["remaining"]):
            if (req["section_id"], day, period) in section_occupancy:
                break  # already taken (manual override or a genuine clash) - falls to gaps
            if any((t, day, period) in teacher_occupancy for t in req["teacher_ids"]):
                break
            place(req, day, period)
            break  # a fixed slot can only ever hold one period of this subject

    for req in priority_reqs:
        place_singles(req, req["remaining"])

    for req in block_reqs:
        remaining = req["remaining"]
        block_size = req["block_size"]
        if remaining >= block_size:
            found = _find_block(req, block_size, periods_per_day, section_occupancy, teacher_occupancy, section_subject_today, avoid_same_day=True)
            if not found:
                found = _find_block(req, block_size, periods_per_day, section_occupancy, teacher_occupancy, section_subject_today, avoid_same_day=False)
            if found:
                day, periods = found
                for period in periods:
                    place(req, day, period)
                remaining -= block_size
            # if no block fits anywhere, fall through and place everything as
            # ordinary single periods instead of leaving it entirely unplaced
        place_singles(req, remaining)

    for req in normal_reqs:
        place_singles(req, req["remaining"])

    return placed_count


def generate(db: Session, academic_year_id: int, section_ids=None):
    """section_ids=None regenerates the whole academic year (default); a list
    scopes the wipe+refill to just those sections, leaving every other
    section's slots completely untouched. Occupancy for conflict-checking is
    still built from the WHOLE year regardless, since a teacher in an
    untouched section can still block a placement in a scoped one."""
    timing = db.query(models.TimingConfig).filter(
        models.TimingConfig.academic_year_id == academic_year_id,
    ).first()
    periods_per_day = timing.periods_per_day if timing else 8

    wipe_query = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.is_manual_override.is_(False),
    )
    if section_ids is not None:
        wipe_query = wipe_query.filter(models.TimetableSlot.section_id.in_(section_ids))
    wipe_query.delete(synchronize_session=False)
    db.flush()

    existing_slots = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
    ).all()
    section_occupancy, teacher_occupancy, section_subject_today = _build_occupancy(existing_slots)

    requirements = _build_requirements(db, academic_year_id, existing_slots)
    if section_ids is not None:
        section_id_set = set(section_ids)
        requirements = [r for r in requirements if r["section_id"] in section_id_set]

    new_slots = []
    placed_count = _place_requirements(
        academic_year_id, requirements, periods_per_day,
        section_occupancy, teacher_occupancy, section_subject_today, new_slots,
    )

    db.add_all(new_slots)
    db.commit()
    return {"placed_count": placed_count}


def generate_selected(db: Session, academic_year_id: int, targets):
    """Fills in ONLY the specific (section_id, gsp_id) gaps in `targets` -
    e.g. a subset of checkboxes the user picked from the gaps list. Unlike
    generate(), nothing is wiped first: every existing slot (auto-generated
    or manual) stays exactly where it is, and this only adds the missing
    periods for the chosen gaps, using the current occupancy as the
    constraint."""
    timing = db.query(models.TimingConfig).filter(
        models.TimingConfig.academic_year_id == academic_year_id,
    ).first()
    periods_per_day = timing.periods_per_day if timing else 8

    existing_slots = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
    ).all()
    section_occupancy, teacher_occupancy, section_subject_today = _build_occupancy(existing_slots)

    target_set = set(targets)
    requirements = _build_requirements(db, academic_year_id, existing_slots)
    requirements = [r for r in requirements if (r["section_id"], r["gsp_id"]) in target_set]

    new_slots = []
    placed_count = _place_requirements(
        academic_year_id, requirements, periods_per_day,
        section_occupancy, teacher_occupancy, section_subject_today, new_slots,
        mark_manual=True,
    )

    db.add_all(new_slots)
    db.commit()
    return {"placed_count": placed_count}
