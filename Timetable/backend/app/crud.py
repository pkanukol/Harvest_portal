import re
from sqlalchemy import func
from sqlalchemy.orm import Session
from . import models

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"]


def normalize_name(name):
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def get_or_create_teacher(db: Session, name, location="Kodathi", cache=None):
    """cache is an optional {(location, normalized_name): Teacher} dict the
    caller keeps across many calls (e.g. one whole import) to avoid a round
    trip per lookup - there are only ~150 distinct teachers behind ~700+
    assignments. Matching is scoped per location - Kodathi and Attibele are
    different campuses with different staff, so same-name coincidences
    across branches must not collide."""
    if not name:
        return None
    norm = normalize_name(name)
    key = (location, norm)
    if cache is not None and key in cache:
        return cache[key]
    teacher = db.query(models.Teacher).filter(
        models.Teacher.normalized_name == norm, models.Teacher.location == location,
    ).first()
    if not teacher:
        teacher = models.Teacher(name=name.strip(), normalized_name=norm, location=location)
        db.add(teacher)
        db.flush()
    if cache is not None:
        cache[key] = teacher
    return teacher


def create_teacher(db: Session, name: str, location: str, linked_email=None):
    """Explicit admin-driven creation (Teachers tab "Add Teacher") - distinct
    from get_or_create_teacher(), which is only ever called during an
    import and silently reuses an existing match. Here a name collision is a
    mistake worth surfacing, not something to quietly resolve."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Name is required")
    norm = normalize_name(name)
    existing = db.query(models.Teacher).filter(
        models.Teacher.normalized_name == norm, models.Teacher.location == location,
    ).first()
    if existing:
        raise ValueError(f"A teacher named '{existing.name}' already exists for {location}")
    teacher = models.Teacher(name=name, normalized_name=norm, location=location, linked_email=(linked_email or "").strip().lower() or None)
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return _teacher_out(teacher)


def _teacher_out(teacher, class_teacher_of=None, subject_assignments=None):
    subject_assignments = subject_assignments or []
    return {
        "id": teacher.id, "name": teacher.name, "linked_email": teacher.linked_email,
        "location": teacher.location, "is_active": teacher.is_active,
        "class_teacher_of": class_teacher_of or [],
        "subject_assignments": subject_assignments,
        "subjects": sorted({a["subject"] for a in subject_assignments}),
        "periods_per_week": sum(a["periods_per_week"] for a in subject_assignments),
    }


def _teacher_class_teacher_of(db: Session, teacher_id: int):
    rows = db.query(models.Section.id, models.Grade.order_index, models.Section.name).join(
        models.Grade, models.Section.grade_id == models.Grade.id,
    ).filter(models.Section.class_teacher_id == teacher_id).all()
    return sorted(
        ({"section_id": sid, "code": f"{oi}{name}"} for sid, oi, name in rows),
        key=lambda r: r["code"],
    )


def _teacher_subject_assignments(db: Session, teacher_id: int):
    rows = db.query(
        models.SectionSubjectTeacher.id, models.Grade.order_index, models.Section.name,
        models.SectionSubjectTeacher.component_label, models.GradeSubjectPeriod.periods_per_week,
    ).join(models.Section, models.SectionSubjectTeacher.section_id == models.Section.id).join(
        models.Grade, models.Section.grade_id == models.Grade.id,
    ).join(
        models.GradeSubjectPeriod, models.SectionSubjectTeacher.grade_subject_period_id == models.GradeSubjectPeriod.id,
    ).filter(models.SectionSubjectTeacher.teacher_id == teacher_id).all()
    return sorted(
        (
            {"sst_id": sid, "code": f"{oi}{name}", "subject": label, "periods_per_week": ppw}
            for sid, oi, name, label, ppw in rows
        ),
        key=lambda r: (r["code"], r["subject"]),
    )


def list_teachers(db: Session, location=None):
    query = db.query(models.Teacher)
    if location:
        query = query.filter(models.Teacher.location == location)
    teachers = query.order_by(func.lower(models.Teacher.name)).all()
    ids = [t.id for t in teachers]
    if not ids:
        return []

    class_teacher_by_tid = {tid: [] for tid in ids}
    class_teacher_rows = db.query(
        models.Section.class_teacher_id, models.Section.id, models.Grade.order_index, models.Section.name,
    ).join(models.Grade, models.Section.grade_id == models.Grade.id).filter(
        models.Section.class_teacher_id.in_(ids),
    ).all()
    for tid, section_id, order_index, section_name in class_teacher_rows:
        class_teacher_by_tid[tid].append({"section_id": section_id, "code": f"{order_index}{section_name}"})

    subj_by_tid = {tid: [] for tid in ids}
    sst_rows = db.query(
        models.SectionSubjectTeacher.teacher_id, models.SectionSubjectTeacher.id,
        models.Grade.order_index, models.Section.name, models.SectionSubjectTeacher.component_label,
        models.GradeSubjectPeriod.periods_per_week,
    ).join(models.Section, models.SectionSubjectTeacher.section_id == models.Section.id).join(
        models.Grade, models.Section.grade_id == models.Grade.id,
    ).join(
        models.GradeSubjectPeriod, models.SectionSubjectTeacher.grade_subject_period_id == models.GradeSubjectPeriod.id,
    ).filter(models.SectionSubjectTeacher.teacher_id.in_(ids)).all()
    for tid, sst_id, order_index, section_name, label, periods_per_week in sst_rows:
        subj_by_tid[tid].append({
            "sst_id": sst_id, "code": f"{order_index}{section_name}", "subject": label,
            "periods_per_week": periods_per_week,
        })

    for tid in ids:
        class_teacher_by_tid[tid].sort(key=lambda r: r["code"])
        subj_by_tid[tid].sort(key=lambda r: (r["code"], r["subject"]))

    return [
        _teacher_out(t, class_teacher_by_tid[t.id], subj_by_tid[t.id])
        for t in teachers
    ]


def set_class_teacher(db: Session, section_id: int, teacher_id):
    section = db.query(models.Section).filter(models.Section.id == section_id).first()
    if not section:
        raise ValueError("Section not found")
    if teacher_id is not None and not db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first():
        raise ValueError("Teacher not found")
    section.class_teacher_id = teacher_id
    db.commit()


def get_section_subject_slots(db: Session, section_id: int):
    ssts = db.query(models.SectionSubjectTeacher).filter(models.SectionSubjectTeacher.section_id == section_id).all()
    return [
        {
            "sst_id": s.id,
            "subject_id": s.grade_subject_period.subject_id,
            "subject": s.grade_subject_period.subject.raw_name,
            "component_label": s.component_label,
            "teacher_id": s.teacher_id,
            "teacher_name": s.teacher.name if s.teacher else None,
        }
        for s in ssts
    ]


def set_sst_teacher(db: Session, sst_id: int, teacher_id):
    sst = db.query(models.SectionSubjectTeacher).filter(models.SectionSubjectTeacher.id == sst_id).first()
    if not sst:
        raise ValueError("Assignment not found")
    if teacher_id is not None and not db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first():
        raise ValueError("Teacher not found")
    sst.teacher_id = teacher_id
    # keep the denormalized copy on already-placed periods in sync
    db.query(models.TimetableSlot).filter(models.TimetableSlot.section_subject_teacher_id == sst_id).update({"teacher_id": teacher_id})
    db.commit()


def list_subjects(db: Session, academic_year_id: int):
    """Every subject in this academic year, with which grade(s) it's taught
    in and at how many periods/week - grouped by normalized name so an
    academic year imported before subjects were de-duplicated at import
    time (several raw Subject rows that are really the same subject, one per
    grade) still shows as a single entry here, not one row per grade."""
    subjects = db.query(models.Subject).filter(models.Subject.academic_year_id == academic_year_id).all()
    grade_name_by_id = dict(
        db.query(models.Grade.id, models.Grade.name).filter(models.Grade.academic_year_id == academic_year_id).all()
    )
    gsps_by_subject = {}
    for gsp in db.query(models.GradeSubjectPeriod).filter(models.GradeSubjectPeriod.academic_year_id == academic_year_id).all():
        gsps_by_subject.setdefault(gsp.subject_id, []).append({
            "grade_name": grade_name_by_id.get(gsp.grade_id), "periods_per_week": gsp.periods_per_week,
        })

    groups = {}
    for s in subjects:
        key = normalize_name(s.raw_name)
        group = groups.setdefault(key, {"ids": [], "raw_name": s.raw_name, "is_combo": False, "grades": []})
        group["ids"].append(s.id)
        group["is_combo"] = group["is_combo"] or s.is_combo
        group["grades"].extend(gsps_by_subject.get(s.id, []))

    return [
        {
            "id": g["ids"][0], "raw_name": g["raw_name"], "is_combo": g["is_combo"],
            "grades": sorted(g["grades"], key=lambda x: x["grade_name"] or ""),
        }
        for g in sorted(groups.values(), key=lambda g: g["raw_name"].lower())
    ]


def rename_subject(db: Session, subject_id: int, new_name: str):
    """Fixes a subject name after the fact (e.g. a parsed-import artifact
    like "History / Civics Senthil" that should just be "History / Civics").
    An academic year imported before subjects were de-duplicated at import
    time can still have several Subject rows that are really the same
    subject (one per grade) - matched here by NORMALIZED name (trimmed,
    collapsed whitespace, case-insensitive), the same grouping list_subjects()
    uses, so renaming one clears every occurrence in one action regardless
    of minor casing/whitespace differences between them."""
    subject = db.query(models.Subject).filter(models.Subject.id == subject_id).first()
    if not subject:
        raise ValueError("Subject not found")
    new_name = (new_name or "").strip()
    if not new_name:
        raise ValueError("Subject name is required")

    old_key = normalize_name(subject.raw_name)
    new_key = normalize_name(new_name)
    all_subjects = db.query(models.Subject).filter(models.Subject.academic_year_id == subject.academic_year_id).all()
    matches = [s for s in all_subjects if normalize_name(s.raw_name) == old_key]
    matched_ids = {s.id for s in matches}
    old_names = {s.raw_name for s in matches}

    # A different name already used by a subject that ISN'T one of these
    # matches would mean silently merging two genuinely distinct subjects -
    # blocked, since that needs a deliberate merge action, not a rename.
    collision = next((s for s in all_subjects if normalize_name(s.raw_name) == new_key and s.id not in matched_ids), None)
    if collision:
        raise ValueError(
            f"A subject named '{collision.raw_name}' already exists for a different grade - renaming to that "
            f"would merge them, which isn't supported here"
        )

    for s in matches:
        s.raw_name = new_name
    # component_label defaults to the subject name for a plain (non-combo)
    # slot - keep those in sync with the rename. A genuine combo's label
    # ("Hindi" on a "Hindi/Kannada/Sanskrit" subject) is deliberately
    # different from raw_name already, so it's untouched here.
    db.query(models.SectionSubjectTeacher).filter(
        models.SectionSubjectTeacher.grade_subject_period_id.in_(
            db.query(models.GradeSubjectPeriod.id).filter(models.GradeSubjectPeriod.subject_id.in_(matched_ids))
        ),
        models.SectionSubjectTeacher.component_label.in_(list(old_names)),
    ).update({"component_label": new_name}, synchronize_session=False)
    db.commit()
    return {"id": subject.id, "raw_name": new_name, "renamed_count": len(matched_ids)}


def add_subject_slot(db: Session, section_id: int, subject_name: str, periods_per_week, component_label=None, teacher_id=None):
    """Adds a subject the section didn't have before (e.g. a newly
    introduced "Skating") and optionally assigns a teacher to it in one step.
    Reuses the Subject/GradeSubjectPeriod for this grade if one with the same
    name already exists (so adding it to a second section doesn't duplicate
    it) - only a genuinely new subject needs periods_per_week supplied."""
    section = db.query(models.Section).filter(models.Section.id == section_id).first()
    if not section:
        raise ValueError("Section not found")
    grade = section.grade
    subject_name = (subject_name or "").strip()
    if not subject_name:
        raise ValueError("Subject name is required")

    subject = db.query(models.Subject).filter(
        models.Subject.academic_year_id == grade.academic_year_id,
        func.lower(models.Subject.raw_name) == subject_name.lower(),
    ).first()
    if not subject:
        subject = models.Subject(academic_year_id=grade.academic_year_id, raw_name=subject_name, is_combo=False)
        db.add(subject)
        db.flush()

    gsp = db.query(models.GradeSubjectPeriod).filter(
        models.GradeSubjectPeriod.grade_id == grade.id, models.GradeSubjectPeriod.subject_id == subject.id,
    ).first()
    if not gsp:
        if not periods_per_week or periods_per_week <= 0:
            raise ValueError(f"'{subject_name}' is new for this grade - give a periods-per-week value for it")
        gsp = models.GradeSubjectPeriod(
            academic_year_id=grade.academic_year_id, grade_id=grade.id, subject_id=subject.id,
            periods_per_week=periods_per_week,
        )
        db.add(gsp)
        db.flush()

    label = (component_label or subject_name).strip()
    if db.query(models.SectionSubjectTeacher).filter(
        models.SectionSubjectTeacher.section_id == section_id,
        models.SectionSubjectTeacher.grade_subject_period_id == gsp.id,
        models.SectionSubjectTeacher.component_label == label,
    ).first():
        raise ValueError(f"This section already has a '{subject.raw_name}' slot labeled '{label}'")

    if teacher_id is not None and not db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first():
        raise ValueError("Teacher not found")

    sst = models.SectionSubjectTeacher(section_id=section_id, grade_subject_period_id=gsp.id, component_label=label, teacher_id=teacher_id)
    db.add(sst)
    db.commit()
    db.refresh(sst)
    return {
        "sst_id": sst.id, "subject_id": subject.id, "subject": subject.raw_name,
        "component_label": sst.component_label, "teacher_id": sst.teacher_id,
        "teacher_name": sst.teacher.name if sst.teacher else None,
    }


def set_teacher_linked_email(db: Session, teacher_id: int, email):
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        return None
    teacher.linked_email = (email or "").strip().lower() or None
    db.commit()
    db.refresh(teacher)
    return _teacher_out(teacher, _teacher_class_teacher_of(db, teacher.id), _teacher_subject_assignments(db, teacher.id))


def update_teacher(db: Session, teacher_id: int, name=None, linked_email=None):
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        return None
    if name is not None and name.strip():
        teacher.name = name.strip()
        teacher.normalized_name = normalize_name(name)
    if linked_email is not None:
        teacher.linked_email = linked_email.strip().lower() or None
    db.commit()
    db.refresh(teacher)
    return _teacher_out(teacher, _teacher_class_teacher_of(db, teacher.id), _teacher_subject_assignments(db, teacher.id))


def delete_or_merge_teacher(db: Session, teacher_id: int, merge_into_id=None):
    """Deletes a teacher outright if they have no real assignments, or - when
    merge_into_id is given - reassigns all their class-teacher/subject/slot
    references onto another teacher first (the standard fix for a duplicate
    created by a name-spelling mismatch) before deleting."""
    teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not teacher:
        raise ValueError("Teacher not found")

    codes = [r["code"] for r in _teacher_class_teacher_of(db, teacher_id)] + \
            [r["code"] for r in _teacher_subject_assignments(db, teacher_id)]

    if codes and not merge_into_id:
        raise ValueError(
            f"This teacher is still assigned to {', '.join(codes)}. Reassign those in the Timetable tab "
            f"first, or merge this record into another teacher via the API before deleting."
        )

    if merge_into_id:
        target = db.query(models.Teacher).filter(models.Teacher.id == merge_into_id).first()
        if not target:
            raise ValueError("Merge-into teacher not found")
        if target.id == teacher.id:
            raise ValueError("Cannot merge a teacher into itself")
        db.query(models.Section).filter(models.Section.class_teacher_id == teacher_id).update({"class_teacher_id": target.id})
        db.query(models.SectionSubjectTeacher).filter(models.SectionSubjectTeacher.teacher_id == teacher_id).update({"teacher_id": target.id})
        db.query(models.TimetableSlot).filter(models.TimetableSlot.teacher_id == teacher_id).update({"teacher_id": target.id})
        if not target.linked_email and teacher.linked_email:
            target.linked_email = teacher.linked_email

    db.delete(teacher)
    db.commit()


def get_teacher_by_email(db: Session, email: str):
    return db.query(models.Teacher).filter(models.Teacher.linked_email == email.strip().lower()).first()


def resolve_section_tokens(db: Session, academic_year_id: int, tokens):
    """tokens: strings like '6A', '7C' -> list of Section ids, scoped to this
    academic year. Raises ValueError naming any token that didn't resolve, so
    a typo scopes generation to nothing silently rather than to the wrong set."""
    grades = db.query(models.Grade).filter(models.Grade.academic_year_id == academic_year_id).all()
    grade_by_num = {}
    for g in grades:
        m = re.search(r"(\d+)", g.name)
        if m:
            grade_by_num[int(m.group(1))] = g

    section_ids, bad_tokens = [], []
    for tok in tokens:
        tok = tok.strip()
        if not tok:
            continue
        m = re.match(r"^(\d{1,2})([A-Za-z]+)$", tok)
        grade = grade_by_num.get(int(m.group(1))) if m else None
        section = db.query(models.Section).filter(
            models.Section.grade_id == grade.id, models.Section.name == m.group(2).upper(),
        ).first() if (m and grade) else None
        if section:
            section_ids.append(section.id)
        else:
            bad_tokens.append(tok)

    if bad_tokens:
        raise ValueError(f"Could not find these grade+section(s): {', '.join(bad_tokens)}")
    return section_ids


def get_active_academic_year(db: Session, location: str):
    return db.query(models.AcademicYear).filter(
        models.AcademicYear.location == location, models.AcademicYear.is_active.is_(True),
    ).first()


def list_academic_years(db: Session, location: str):
    """Every saved timetable for a location - importing a new one (label "C")
    only flips is_active, it never deletes the others, so an older one
    (label "B") can always be switched back to via activate_academic_year()."""
    years = db.query(models.AcademicYear).filter(
        models.AcademicYear.location == location,
    ).order_by(models.AcademicYear.created_at.desc()).all()
    return [
        {
            "id": y.id, "label": y.label, "location": y.location, "is_active": y.is_active,
            "created_at": y.created_at.isoformat() if y.created_at else None,
        }
        for y in years
    ]


def activate_academic_year(db: Session, academic_year_id: int, location: str):
    year = db.query(models.AcademicYear).filter(
        models.AcademicYear.id == academic_year_id, models.AcademicYear.location == location,
    ).first()
    if not year:
        raise ValueError("Academic year not found for this location")
    db.query(models.AcademicYear).filter(models.AcademicYear.location == location).update({"is_active": False})
    year.is_active = True
    db.commit()
    return {"id": year.id, "label": year.label, "location": year.location, "is_active": True}


def deactivate_academic_year(db: Session, academic_year_id: int, location: str):
    """Turns off the active timetable without activating another one - the
    location is left with nothing active until something else is switched
    on (or a new one imported), which is a deliberate, explicit choice here
    rather than something that happens as a side effect of another action."""
    year = db.query(models.AcademicYear).filter(
        models.AcademicYear.id == academic_year_id, models.AcademicYear.location == location,
    ).first()
    if not year:
        raise ValueError("Academic year not found for this location")
    year.is_active = False
    db.commit()
    return {"id": year.id, "label": year.label, "location": year.location, "is_active": False}


def delete_academic_year(db: Session, academic_year_id: int, location: str):
    """Permanently removes a saved timetable no longer needed - including the
    currently active one, if that's genuinely what's wanted (the frontend
    warns strongly before this call for that case, since the location is
    left with nothing active afterward)."""
    year = db.query(models.AcademicYear).filter(
        models.AcademicYear.id == academic_year_id, models.AcademicYear.location == location,
    ).first()
    if not year:
        raise ValueError("Academic year not found for this location")
    # Substitution is a pure history log with no relationship declared on
    # AcademicYear (deliberately kept out of the Grade/Section/SST object
    # graph), so it isn't reached by the grades/subjects/timing_config
    # cascades below and needs deleting explicitly first, or the database
    # rejects the delete with a foreign key violation.
    db.query(models.Substitution).filter(models.Substitution.academic_year_id == academic_year_id).delete()
    db.delete(year)
    db.commit()


# ---------------------------------------------------------------------------
# Import commit
# ---------------------------------------------------------------------------

def commit_import(db: Session, label: str, location: str, parsed: dict, rules_text: str = None) -> models.AcademicYear:
    teacher_cache = {(t.location, t.normalized_name): t for t in db.query(models.Teacher).all()}
    # Subject is scoped per academic year, not per grade - the same subject
    # name (e.g. "Math", or two grades happening to share an identical raw
    # label) is the same subject everywhere in this import, not a fresh one
    # per grade. Without this cache, every grade's subject list created its
    # own separate Subject row even for identical text, so fixing a name
    # (e.g. a parsing artifact) meant hunting down and renaming it once per
    # grade instead of once for the whole academic year.
    subject_cache = {}  # raw_name.strip().lower() -> Subject, reused across every grade in this import
    db.query(models.AcademicYear).filter(models.AcademicYear.location == location).update({"is_active": False})

    year = models.AcademicYear(label=label, location=location, is_active=True, rules_text=rules_text)
    db.add(year)
    db.flush()

    timing = parsed["timing"]
    db.add(models.TimingConfig(
        academic_year_id=year.id,
        class_teacher_start=timing["class_teacher_start"],
        class_teacher_end=timing["class_teacher_end"],
        periods_per_day=timing["periods_per_day"],
        schedule=timing["schedule"],
    ))

    for grade_data in parsed["grades"]:
        grade = models.Grade(
            academic_year_id=year.id,
            name=grade_data["name"],
            order_index=grade_data["order_index"],
        )
        db.add(grade)
        db.flush()

        section_objs = {}
        for sec_name, sec_data in grade_data["sections"].items():
            class_teacher = get_or_create_teacher(db, sec_data.get("class_teacher_name"), location, teacher_cache)
            section = models.Section(
                grade_id=grade.id, name=sec_name,
                class_teacher_id=class_teacher.id if class_teacher else None,
            )
            db.add(section)
            db.flush()
            section_objs[sec_name] = section

        for subj_data in grade_data["subjects"]:
            subject_key = subj_data["raw_name"].strip().lower()
            subject = subject_cache.get(subject_key)
            if not subject:
                subject = models.Subject(
                    academic_year_id=year.id,
                    raw_name=subj_data["raw_name"],
                    is_combo=subj_data["is_combo"],
                )
                db.add(subject)
                db.flush()
                subject_cache[subject_key] = subject

            gsp = models.GradeSubjectPeriod(
                academic_year_id=year.id, grade_id=grade.id, subject_id=subject.id,
                periods_per_week=subj_data["periods_per_week"],
            )
            db.add(gsp)
            db.flush()

            for sec_name, components in subj_data["assignments"].items():
                section = section_objs[sec_name]
                for comp in components:
                    teacher = get_or_create_teacher(db, comp.get("teacher_name"), location, teacher_cache)
                    db.add(models.SectionSubjectTeacher(
                        section_id=section.id,
                        grade_subject_period_id=gsp.id,
                        component_label=comp["component_label"],
                        teacher_id=teacher.id if teacher else None,
                    ))

    db.commit()
    db.refresh(year)
    return year


def place_generated_slots(db: Session, academic_year_id: int, lessons):
    """Inserts TimetableSlot rows straight from an already-placed timetable
    export (see app/timetable_workbook.py), instead of running the scheduler.
    Everything is marked is_manual_override=True - this came from a real,
    already-finalized timetable, so a later Generate run must never touch or
    re-shuffle it. Assumes commit_import() just created the matching
    Section/SectionSubjectTeacher rows from the same lessons (same academic
    year) - looks them up by (grade+section, subject/component_label,
    normalized teacher name), matched only within THIS academic year's own
    sections/SSTs - never against the global Teacher table, since the same
    teacher name can legitimately exist at a different school/location and
    would otherwise silently resolve to the wrong teacher_id there."""
    sections = db.query(models.Section).join(models.Grade).filter(
        models.Grade.academic_year_id == academic_year_id,
    ).all()
    section_id_by_key = {(s.grade.name, s.name): s.id for s in sections}

    ssts = db.query(models.SectionSubjectTeacher).join(models.Section).join(models.Grade).filter(
        models.Grade.academic_year_id == academic_year_id,
    ).all()
    sst_by_key = {}
    for sst in ssts:
        section = sst.section
        teacher_norm = normalize_name(sst.teacher.name) if sst.teacher else None
        key = (section.grade.name, section.name, normalize_name(sst.component_label), teacher_norm)
        sst_by_key[key] = (sst.id, sst.teacher_id)

    placed, skipped = 0, 0
    for l in lessons:
        section_id = section_id_by_key.get((l["grade_name"], l["section_name"]))
        if not section_id:
            skipped += 1
            continue
        teacher_norm = normalize_name(l["teacher_name"]) if l["teacher_name"] else None
        match = sst_by_key.get((l["grade_name"], l["section_name"], normalize_name(l["subject"]), teacher_norm))
        if not match:
            skipped += 1
            continue
        sst_id, teacher_id = match
        db.add(models.TimetableSlot(
            academic_year_id=academic_year_id, section_id=section_id,
            day_of_week=l["day_of_week"], period_number=l["period_number"],
            section_subject_teacher_id=sst_id, teacher_id=teacher_id,
            is_manual_override=True,
        ))
        placed += 1
    db.commit()
    return {"placed": placed, "skipped": skipped}


def apply_teacher_details(db: Session, academic_year_id: int, location: str, details):
    """Fills in the two things an already-placed timetable export can't tell
    us (see timetable_workbook.parse_teacher_details_sheet): a teacher's
    linked_email and which section they're the class teacher of. Everything
    else about that sheet (Allocation/Subject) is already derived from the
    timetable itself, so it's intentionally not read here."""
    warnings = []
    updated_email = updated_class_teacher = 0

    grade_by_order = {
        g.order_index: g for g in db.query(models.Grade).filter(models.Grade.academic_year_id == academic_year_id).all()
    }

    for d in details:
        teacher = db.query(models.Teacher).filter(
            models.Teacher.normalized_name == normalize_name(d["name"]), models.Teacher.location == location,
        ).first()
        if not teacher:
            warnings.append(f"Teacher details: {d['name']!r} not found among the teachers in this timetable, skipped")
            continue

        if d.get("email"):
            teacher.linked_email = d["email"].strip().lower()
            updated_email += 1

        if d.get("class_teacher_grade") is not None and d.get("class_teacher_section"):
            grade = grade_by_order.get(d["class_teacher_grade"])
            section = db.query(models.Section).filter(
                models.Section.grade_id == grade.id, models.Section.name == d["class_teacher_section"],
            ).first() if grade else None
            if section:
                section.class_teacher_id = teacher.id
                updated_class_teacher += 1
            else:
                warnings.append(
                    f"Teacher details: class-teacher section "
                    f"'{d['class_teacher_grade']}{d['class_teacher_section']}' for {d['name']!r} not found"
                )

    db.commit()
    return {"updated_email": updated_email, "updated_class_teacher": updated_class_teacher, "warnings": warnings}


# ---------------------------------------------------------------------------
# Timetable read
# ---------------------------------------------------------------------------

def get_section_timetable(db: Session, academic_year_id: int, section_id: int):
    section = db.query(models.Section).filter(models.Section.id == section_id).first()
    if not section:
        return None

    slots = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.section_id == section_id,
    ).all()
    section_ssts = db.query(models.SectionSubjectTeacher).filter(
        models.SectionSubjectTeacher.section_id == section_id,
    ).all()
    gsps = db.query(models.GradeSubjectPeriod).filter(
        models.GradeSubjectPeriod.academic_year_id == academic_year_id,
        models.GradeSubjectPeriod.grade_id == section.grade_id,
    ).all()
    grade = db.query(models.Grade).filter(models.Grade.id == section.grade_id).first()

    # Batch every lookup up front instead of lazy-loading relationships per
    # slot/sst (that was ~100+ extra round trips for one section view alone).
    sst_by_id = {s.id: s for s in section_ssts}
    gsp_by_id = {g.id: g for g in gsps}
    subject_ids = {g.subject_id for g in gsps}
    subject_name_by_id = dict(
        db.query(models.Subject.id, models.Subject.raw_name).filter(models.Subject.id.in_(subject_ids)).all()
    ) if subject_ids else {}
    teacher_ids = {s.teacher_id for s in slots if s.teacher_id} | {s.teacher_id for s in section_ssts if s.teacher_id}
    if section.class_teacher_id:
        teacher_ids.add(section.class_teacher_id)
    teacher_name_by_id = dict(
        db.query(models.Teacher.id, models.Teacher.name).filter(models.Teacher.id.in_(teacher_ids)).all()
    ) if teacher_ids else {}

    def slot_entry(slot):
        sst = sst_by_id.get(slot.section_subject_teacher_id)
        gsp = gsp_by_id.get(sst.grade_subject_period_id) if sst else None
        return {
            "slot_id": slot.id,
            "section_subject_teacher_id": sst.id if sst else None,
            "grade_subject_period_id": sst.grade_subject_period_id if sst else None,
            "subject": subject_name_by_id.get(gsp.subject_id) if gsp else None,
            "component_label": sst.component_label if sst else None,
            "teacher_id": slot.teacher_id,
            "teacher_name": teacher_name_by_id.get(slot.teacher_id) if slot.teacher_id else None,
            "is_manual_override": slot.is_manual_override,
        }

    grid = {}
    placed_counts_by_sst = {}
    for slot in slots:
        key = f"{slot.day_of_week}-{slot.period_number}"
        grid.setdefault(key, []).append(slot_entry(slot))
        if slot.section_subject_teacher_id:
            placed_counts_by_sst[slot.section_subject_teacher_id] = placed_counts_by_sst.get(slot.section_subject_teacher_id, 0) + 1

    ssts_by_gsp = {}
    for sst in section_ssts:
        ssts_by_gsp.setdefault(sst.grade_subject_period_id, []).append(sst)

    available_subjects = [
        {
            "grade_subject_period_id": gsp.id,
            "subject": subject_name_by_id.get(gsp.subject_id),
            "periods_per_week": gsp.periods_per_week,
            "placed_count": max((placed_counts_by_sst.get(sst.id, 0) for sst in ssts_by_gsp.get(gsp.id, [])), default=0),
            "options": [
                {"section_subject_teacher_id": sst.id, "component_label": sst.component_label,
                 "teacher_name": teacher_name_by_id.get(sst.teacher_id) if sst.teacher_id else None}
                for sst in ssts_by_gsp.get(gsp.id, [])
            ],
        }
        for gsp in gsps
    ]

    return {
        "section_id": section.id,
        "grade_name": grade.name if grade else None,
        "section_name": section.name,
        "class_teacher_name": teacher_name_by_id.get(section.class_teacher_id) if section.class_teacher_id else None,
        "grid": grid,
        "available_subjects": available_subjects,
    }


def get_teacher_week(db: Session, academic_year_id: int, teacher_id: int):
    slots = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.teacher_id == teacher_id,
    ).all()
    if not slots:
        return []

    section_ids = {s.section_id for s in slots}
    sections = db.query(models.Section).filter(models.Section.id.in_(section_ids)).all()
    grade_ids = {s.grade_id for s in sections}
    grade_name_by_id = dict(db.query(models.Grade.id, models.Grade.name).filter(models.Grade.id.in_(grade_ids)).all())
    section_label = {s.id: (grade_name_by_id.get(s.grade_id), s.name) for s in sections}

    sst_ids = {s.section_subject_teacher_id for s in slots if s.section_subject_teacher_id}
    ssts = db.query(models.SectionSubjectTeacher).filter(models.SectionSubjectTeacher.id.in_(sst_ids)).all() if sst_ids else []
    sst_by_id = {s.id: s for s in ssts}
    gsp_ids = {s.grade_subject_period_id for s in ssts}
    gsps = db.query(models.GradeSubjectPeriod).filter(models.GradeSubjectPeriod.id.in_(gsp_ids)).all() if gsp_ids else []
    gsp_by_id = {g.id: g for g in gsps}
    subject_ids = {g.subject_id for g in gsps}
    subject_name_by_id = dict(
        db.query(models.Subject.id, models.Subject.raw_name).filter(models.Subject.id.in_(subject_ids)).all()
    ) if subject_ids else {}

    out = []
    for slot in slots:
        sst = sst_by_id.get(slot.section_subject_teacher_id)
        gsp = gsp_by_id.get(sst.grade_subject_period_id) if sst else None
        grade_name, section_name = section_label.get(slot.section_id, (None, None))
        out.append({
            "day_of_week": slot.day_of_week,
            "period_number": slot.period_number,
            "grade_name": grade_name,
            "section_name": section_name,
            "subject": subject_name_by_id.get(gsp.subject_id) if gsp else None,
            "component_label": sst.component_label if sst else None,
        })
    return out


def get_all_lessons(db: Session, academic_year_id: int):
    """Every placed, teacher-assigned lesson for the whole week - the shape
    substitution.compute_suggestions() expects. Used instead of per-teacher
    get_teacher_week() since finding a substitute needs to know about every
    OTHER teacher's occupancy and assignments too, not just the absent one's."""
    slots = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.teacher_id.isnot(None),
    ).all()
    if not slots:
        return []

    section_ids = {s.section_id for s in slots}
    sections = db.query(models.Section).filter(models.Section.id.in_(section_ids)).all()
    grade_ids = {s.grade_id for s in sections}
    grade_name_by_id = dict(db.query(models.Grade.id, models.Grade.name).filter(models.Grade.id.in_(grade_ids)).all())
    section_label = {s.id: (grade_name_by_id.get(s.grade_id), s.name) for s in sections}

    sst_ids = {s.section_subject_teacher_id for s in slots if s.section_subject_teacher_id}
    ssts = db.query(models.SectionSubjectTeacher).filter(models.SectionSubjectTeacher.id.in_(sst_ids)).all() if sst_ids else []
    sst_by_id = {s.id: s for s in ssts}
    gsp_ids = {s.grade_subject_period_id for s in ssts}
    gsps = db.query(models.GradeSubjectPeriod).filter(models.GradeSubjectPeriod.id.in_(gsp_ids)).all() if gsp_ids else []
    gsp_by_id = {g.id: g for g in gsps}
    subject_ids = {g.subject_id for g in gsps}
    subject_name_by_id = dict(
        db.query(models.Subject.id, models.Subject.raw_name).filter(models.Subject.id.in_(subject_ids)).all()
    ) if subject_ids else {}
    teacher_ids = {s.teacher_id for s in slots}
    teacher_name_by_id = dict(db.query(models.Teacher.id, models.Teacher.name).filter(models.Teacher.id.in_(teacher_ids)).all())

    out = []
    for slot in slots:
        sst = sst_by_id.get(slot.section_subject_teacher_id)
        gsp = gsp_by_id.get(sst.grade_subject_period_id) if sst else None
        grade_name, section_name = section_label.get(slot.section_id, (None, None))
        subject = (sst.component_label if sst else None) or (subject_name_by_id.get(gsp.subject_id) if gsp else None)
        out.append({
            "day_of_week": slot.day_of_week,
            "period_number": slot.period_number,
            "grade_name": grade_name,
            "section_name": section_name,
            "subject": subject or "?",
            "teacher_name": teacher_name_by_id.get(slot.teacher_id),
        })
    return out


def list_active_teacher_names(db: Session, location: str):
    return [
        t.name for t in db.query(models.Teacher).filter(
            models.Teacher.location == location, models.Teacher.is_active.is_(True),
        ).all()
    ]


# ---------------------------------------------------------------------------
# Substitutions - one-off (date-specific) records, kept separate from the
# recurring weekly TimetableSlot rows.
# ---------------------------------------------------------------------------

def _substitution_out(sub):
    return {
        "id": sub.id, "academic_year_id": sub.academic_year_id, "date": sub.date,
        "day_of_week": sub.day_of_week, "period_number": sub.period_number,
        "grade_name": sub.grade_name, "section_name": sub.section_name, "subject": sub.subject,
        "absent_teacher_name": sub.absent_teacher_name, "absent_teacher_id": sub.absent_teacher_id,
        "substitute_teacher_name": sub.substitute_teacher_name, "substitute_teacher_id": sub.substitute_teacher_id,
        "tier": sub.tier, "created_by_name": sub.created_by_name,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


def create_substitution(db: Session, data: dict):
    sub = models.Substitution(**data)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return _substitution_out(sub)


def list_substitutions(db: Session, academic_year_id: int, date=None, teacher_name=None):
    query = db.query(models.Substitution).filter(models.Substitution.academic_year_id == academic_year_id)
    if date:
        query = query.filter(models.Substitution.date == date)
    if teacher_name:
        query = query.filter(func.lower(models.Substitution.absent_teacher_name) == teacher_name.strip().lower())
    subs = query.order_by(models.Substitution.date.desc(), models.Substitution.period_number).all()
    return [_substitution_out(s) for s in subs]


def delete_substitution(db: Session, substitution_id: int):
    """Clears a recorded substitution that's no longer needed (e.g. the
    absence didn't happen after all) - purely a history record, so deleting
    it has no effect on the actual recurring timetable."""
    sub = db.query(models.Substitution).filter(models.Substitution.id == substitution_id).first()
    if not sub:
        raise ValueError("Substitution not found")
    db.delete(sub)
    db.commit()


# ---------------------------------------------------------------------------
# Timetable write / clash detection
# ---------------------------------------------------------------------------

def check_conflicts(db: Session, academic_year_id: int, day: int, period: int, teacher_ids, exclude_section_id=None):
    teacher_ids = [t for t in teacher_ids if t]
    if not teacher_ids:
        return []
    existing = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.day_of_week == day,
        models.TimetableSlot.period_number == period,
        models.TimetableSlot.teacher_id.in_(teacher_ids),
    ).all()
    conflicts = []
    for slot in existing:
        if exclude_section_id is not None and slot.section_id == exclude_section_id:
            continue
        conflicts.append({
            "teacher_id": slot.teacher_id,
            "teacher_name": slot.teacher.name if slot.teacher else None,
            "grade_name": slot.section.grade.name,
            "section_name": slot.section.name,
        })
    return conflicts


def suggest_alternative_slot(db: Session, academic_year_id: int, section_id: int, teacher_ids, exclude_day=None, exclude_period=None):
    """Finds a free day/period for this section where none of teacher_ids are
    already busy elsewhere - used to suggest a fix when a save is blocked."""
    timing = db.query(models.TimingConfig).filter(models.TimingConfig.academic_year_id == academic_year_id).first()
    periods_per_day = timing.periods_per_day if timing else 8

    section_slots = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.section_id == section_id,
    ).all()
    section_occupancy = {(s.day_of_week, s.period_number) for s in section_slots}

    teacher_ids = [t for t in teacher_ids if t]
    teacher_occupancy = set()
    if teacher_ids:
        teacher_slots = db.query(models.TimetableSlot).filter(
            models.TimetableSlot.academic_year_id == academic_year_id,
            models.TimetableSlot.teacher_id.in_(teacher_ids),
        ).all()
        teacher_occupancy = {(s.day_of_week, s.period_number) for s in teacher_slots}

    for day in range(5):
        for period in range(1, periods_per_day + 1):
            if (day, period) == (exclude_day, exclude_period):
                continue
            if (day, period) in section_occupancy or (day, period) in teacher_occupancy:
                continue
            return f"{DAY_NAMES[day]} Period {period} is free for this section and all its teachers."
    return None


def set_slot(db: Session, academic_year_id: int, section_id: int, day: int, period: int,
             section_subject_teacher_ids, force: bool = False):
    ssts = []
    if section_subject_teacher_ids:
        ssts = db.query(models.SectionSubjectTeacher).filter(
            models.SectionSubjectTeacher.id.in_(section_subject_teacher_ids),
        ).all()
        if len(ssts) != len(section_subject_teacher_ids):
            raise ValueError("One or more section_subject_teacher_id not found")
        if any(s.section_id != section_id for s in ssts):
            raise ValueError("A section_subject_teacher does not belong to this section")
        if len({s.grade_subject_period_id for s in ssts}) > 1:
            raise ValueError("Slot occupants must all belong to the same subject (parallel group)")

    teacher_ids = [s.teacher_id for s in ssts]
    conflicts = check_conflicts(db, academic_year_id, day, period, teacher_ids, exclude_section_id=section_id)

    if conflicts and not force:
        suggestion = suggest_alternative_slot(db, academic_year_id, section_id, teacher_ids, exclude_day=day, exclude_period=period)
        return {"ok": False, "conflicts": conflicts, "suggestion": suggestion}

    db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.section_id == section_id,
        models.TimetableSlot.day_of_week == day,
        models.TimetableSlot.period_number == period,
    ).delete()

    for s in ssts:
        db.add(models.TimetableSlot(
            academic_year_id=academic_year_id, section_id=section_id,
            day_of_week=day, period_number=period,
            section_subject_teacher_id=s.id, teacher_id=s.teacher_id,
            is_manual_override=True,
        ))
    db.commit()
    return {"ok": True, "conflicts": conflicts}


# ---------------------------------------------------------------------------
# Gaps - computed live from current DB state (not stored), so this always
# reflects reality: it persists across tab switches/reloads and shrinks
# automatically as slots get manually placed, with no separate "resolved"
# tracking needed.
# ---------------------------------------------------------------------------

def _find_swap_destination(blocker_section_id, blocker_teacher_id, periods_per_day, section_occupancy, teacher_slot_owner):
    """Is there some other (day, period) where the blocking teacher's class
    could be relocated to - i.e. free for both that teacher and that section?
    If so, that's the actual fix for the gap (move the blocker, not just
    describe it)."""
    for day in range(5):
        for period in range(1, periods_per_day + 1):
            if (blocker_section_id, day, period) in section_occupancy:
                continue
            if (blocker_teacher_id, day, period) in teacher_slot_owner:
                continue
            return day, period
    return None


def lock_timetable(db: Session, academic_year_id: int):
    """Marks every currently-placed slot as a manual override, so a future
    Generate run (full or scoped) treats the whole thing as already-fixed and
    only fills in whatever's still missing - it never wipes and re-shuffles
    what's already here. This is the one-time "I'm happy with this, stop
    touching it" action; without it, the wipe step in generate() would clear
    anything not explicitly saved this way on the next regenerate."""
    count = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
        models.TimetableSlot.is_manual_override.is_(False),
    ).update({"is_manual_override": True}, synchronize_session=False)
    db.commit()
    return count


def get_gaps(db: Session, academic_year_id: int):
    """Everything here is pre-fetched into a fixed, small number of queries
    (independent of how many grades/subjects/sections exist) and then joined
    in memory. The previous version issued a fresh query per (subject,
    section) pair plus lazy-loaded relationships inside the loop - with the
    real dataset that was 750+ round trips to the remote DB, which is what
    was actually causing "request timed out", not anything to do with
    re-generating or not using saved data."""
    timing = db.query(models.TimingConfig).filter(models.TimingConfig.academic_year_id == academic_year_id).first()
    periods_per_day = timing.periods_per_day if timing else 8

    all_slots = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.academic_year_id == academic_year_id,
    ).all()

    section_occupancy = set()
    teacher_slot_owner = {}  # (teacher_id, day, period) -> section_id (for reporting who's blocking)
    placed_counts = {}  # section_subject_teacher_id -> count
    for slot in all_slots:
        section_occupancy.add((slot.section_id, slot.day_of_week, slot.period_number))
        if slot.teacher_id:
            teacher_slot_owner[(slot.teacher_id, slot.day_of_week, slot.period_number)] = slot.section_id
        if slot.section_subject_teacher_id:
            placed_counts[slot.section_subject_teacher_id] = placed_counts.get(slot.section_subject_teacher_id, 0) + 1

    grade_name_by_id = {}
    grade_order_by_id = {}
    for gid, gname, order_index in db.query(
        models.Grade.id, models.Grade.name, models.Grade.order_index,
    ).filter(models.Grade.academic_year_id == academic_year_id).all():
        grade_name_by_id[gid] = gname
        grade_order_by_id[gid] = order_index

    sections_by_grade_id = {}
    section_label = {}
    if grade_name_by_id:
        for s in db.query(models.Section).filter(models.Section.grade_id.in_(grade_name_by_id.keys())).all():
            sections_by_grade_id.setdefault(s.grade_id, []).append(s)
            section_label[s.id] = (grade_name_by_id[s.grade_id], s.name)

    ssts_by_section_gsp = {}
    if section_label:
        for sst in db.query(models.SectionSubjectTeacher).filter(
            models.SectionSubjectTeacher.section_id.in_(section_label.keys()),
        ).all():
            ssts_by_section_gsp.setdefault((sst.section_id, sst.grade_subject_period_id), []).append(sst)

    teacher_name_by_id = dict(db.query(models.Teacher.id, models.Teacher.name).all())
    subject_name_by_id = dict(db.query(models.Subject.id, models.Subject.raw_name).all())

    gaps = []
    gsps = db.query(models.GradeSubjectPeriod).filter(
        models.GradeSubjectPeriod.academic_year_id == academic_year_id,
    ).all()
    for gsp in gsps:
        for section in sections_by_grade_id.get(gsp.grade_id, []):
            ssts = ssts_by_section_gsp.get((section.id, gsp.id), [])
            if not ssts:
                continue
            placed = max((placed_counts.get(s.id, 0) for s in ssts), default=0)
            missing = gsp.periods_per_week - placed
            if missing <= 0:
                continue

            teacher_ids = [s.teacher_id for s in ssts if s.teacher_id]
            direct_suggestion = None
            swap_suggestion = None
            for day in range(5):
                for period in range(1, periods_per_day + 1):
                    if (section.id, day, period) in section_occupancy:
                        continue
                    blocker_teacher_id = next(
                        (t for t in teacher_ids if (t, day, period) in teacher_slot_owner),
                        None,
                    )
                    if blocker_teacher_id is None:
                        direct_suggestion = f"{DAY_NAMES[day]} Period {period} is free for this section with no clash."
                        break
                    if swap_suggestion is None:
                        blocker_section_id = teacher_slot_owner[(blocker_teacher_id, day, period)]
                        blocker_grade, blocker_section_name = section_label.get(blocker_section_id, ("?", "?"))
                        teacher_name = teacher_name_by_id.get(blocker_teacher_id, "?")
                        dest = _find_swap_destination(
                            blocker_section_id, blocker_teacher_id, periods_per_day, section_occupancy, teacher_slot_owner,
                        )
                        if dest:
                            dest_day, dest_period = dest
                            swap_suggestion = (
                                f"Fix: move {teacher_name}'s {blocker_grade} {blocker_section_name} class from "
                                f"{DAY_NAMES[day]} Period {period} to {DAY_NAMES[dest_day]} Period {dest_period} "
                                f"(free for both {teacher_name} and that section) - that opens up "
                                f"{DAY_NAMES[day]} Period {period} for this."
                            )
                        else:
                            swap_suggestion = (
                                f"{DAY_NAMES[day]} Period {period} is free for the section, but {teacher_name} is "
                                f"already teaching {blocker_grade} {blocker_section_name} then, and there's no other "
                                f"free slot to move that class to either."
                            )
                else:
                    continue
                break
            suggestion = direct_suggestion or swap_suggestion

            gaps.append({
                "section_id": section.id,
                "gsp_id": gsp.id,
                "grade_name": grade_name_by_id[gsp.grade_id],
                "grade_order_index": grade_order_by_id[gsp.grade_id],
                "section_name": section.name,
                "subject": subject_name_by_id.get(gsp.subject_id, "?"),
                "missing_periods": missing,
                "suggestion": suggestion or "No free period left for this section anywhere in the week.",
            })
    return gaps
