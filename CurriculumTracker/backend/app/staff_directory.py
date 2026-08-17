"""Read-only view of staff_roles, which lives in a SEPARATE Supabase project
(see config.STAFF_SUPABASE_URL) owned by another app. Email is the join key
between that project and this one's `users` table.

It answers a question this app otherwise can't: WHICH CLASSES a teacher is
assigned. Without it, curriculum lag can only be measured for a (teacher,
subject, grade) that already has a POW — so a teacher who has submitted
nothing for a class they teach looks identical to one who doesn't teach it.

Nothing here writes. If the table is unreachable, or RLS returns no rows, every
function degrades to "no assignment data" and the lag report falls back to its
POW-derived behaviour rather than failing.

teaching_sections format (the other app's convention, documented in
Timetable/frontend-v2/src/lib/teachingSectionsSync.js): a list of
"Subject|GradeSection" strings — "Maths|6A", "Physics|10B". A teacher who
teaches only ONE subject records it with the subject left blank: "|1A", "|1B".
A teacher with several subjects only omits the name for their first, so a blank
entry is only safely resolved to a specific subject when the teacher has no
other labelled subject at all.
"""
import re
import time
import logging
import httpx

from .config import settings

logger = logging.getLogger("curriculum_tracker")

# Same synonym pairs the Timetable sync uses — staff_roles records the lower
# grades' science as "EVS" where the curriculum sheets say "Science".
SUBJECT_SYNONYMS = [
    ("evs", "science"),
]

# staff_roles writes subject names its own way; the curriculum sheets are
# uploaded under the names in crud.CURRICULUM_SUBJECTS. Mapped from the live
# data (distinct teaching_sections subjects, 2026-08-16):
#
#   Maths / Math_            -> Mathematics
#   Kannada II/III Lang      -> Kannada        (same curriculum, language tier)
#   Hindi III Lang           -> Hindi
#   Physics_ / Chemistry_ / Biology_ -> trailing-underscore data entry variants
#   Geography & Economics    -> Social Science (its sheets carry Geography and
#                               Economics as Discipline values)
#
# Anything not listed (PE, SPA, Library, Dance, Art, Music, Karate, Computer
# Science, Sanskrit, AI, French...) simply has no curriculum workbook, and the
# lag report skips a subject+grade with no planner rows anyway.
SUBJECT_ALIASES = {
    "maths": "Mathematics",
    "math": "Mathematics",
    "mathematics": "Mathematics",
    "kannada": "Kannada",
    "hindi": "Hindi",
    "english": "English",
    "science": "Science",
    "evs": "Science",
    "physics": "Physics",
    "chemistry": "Chemistry",
    "biology": "Biology",
    "social science": "Social Science",
    "geography & economics": "Social Science",
    "geography and economics": "Social Science",
}

# "Kannada II Lang" / "Hindi III Lang" — the language tier is a grouping in
# the timetable, not a different curriculum.
_LANG_TIER = re.compile(r"\s+(i{1,3}|1|2|3)\s*(st|nd|rd|th)?\s*lang(uage)?\.?$", re.I)


def canonical_subject(name: str) -> str:
    """staff_roles subject name -> curriculum subject name, or the cleaned-up
    original when there's no mapping (harmless — it just won't match a
    planner)."""
    cleaned = re.sub(r"[_\s]+$", "", (name or "").strip())
    cleaned = _LANG_TIER.sub("", cleaned).strip()
    return SUBJECT_ALIASES.get(cleaned.lower(), cleaned)

_cache = {"at": 0.0, "by_email": {}, "ok": False}


def _normalize(s) -> str:
    return (s or "").strip().lower()


def subjects_match(a: str, b: str) -> bool:
    na, nb = _normalize(a), _normalize(b)
    if not na or not nb:
        return False
    if na == nb or na in nb or nb in na:
        return True
    return any((x in na and y in nb) or (y in na and x in nb) for x, y in SUBJECT_SYNONYMS)


def parse_teaching_sections(entries, fallback_subject: str = "") -> list:
    """-> [{"subject", "grade", "section"}], one per assigned class.

    Grades outside 1-10 and unparseable entries are dropped. A blank subject
    resolves to fallback_subject only when NO entry names a subject — with a
    mix, the blanks belong to some other subject that can't be identified from
    the string, and guessing would invent an assignment that doesn't exist.
    """
    raw = [str(e) for e in (entries or []) if str(e).strip()]
    labelled = [e for e in raw if e.split("|")[0].strip()]
    lone_subject = fallback_subject if not labelled else ""

    out = []
    seen = set()
    for entry in raw:
        parts = entry.split("|")
        if len(parts) < 2:
            continue
        raw_subject = parts[0].strip() or lone_subject
        subject = canonical_subject(raw_subject)
        token = parts[1].strip()
        if not subject or not token:
            continue
        m = re.match(r"\s*(\d{1,2})", token)
        if not m:
            continue
        grade = int(m.group(1))
        if not 1 <= grade <= 10:
            continue
        section = token[m.end():].strip().upper()
        key = (subject.lower(), grade, section)
        if key in seen:
            continue
        seen.add(key)
        out.append({"subject": subject, "grade": grade, "section": section})
    return out


def _fetch() -> dict:
    # Service key when configured — that project's policies only admit the
    # `authenticated` role, so the publishable (anon) key reads back nothing.
    key = settings.STAFF_SUPABASE_SERVICE_KEY or settings.STAFF_SUPABASE_ANON_KEY
    resp = httpx.get(
        f"{settings.STAFF_SUPABASE_URL}/rest/v1/staff_roles",
        params={"select": "email,name,designation,subjects,teaching_sections,active"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=8,
    )
    resp.raise_for_status()
    rows = resp.json()

    by_email = {}
    for row in rows:
        email = _normalize(row.get("email"))
        if not email or row.get("active") is False:
            continue
        subjects = row.get("subjects") or []
        if isinstance(subjects, str):
            subjects = [subjects]
        fallback = subjects[0] if len(subjects) == 1 else ""
        by_email[email] = {
            "email": email,
            "name": row.get("name") or "",
            "designation": row.get("designation") or "",
            "subjects": [s for s in subjects if s],
            "assignments": parse_teaching_sections(row.get("teaching_sections"), fallback),
        }
    return by_email


def get_directory(force: bool = False) -> dict:
    """Cached {email: {...}}. Empty dict when staff_roles is unreachable or
    returns nothing — callers must treat empty as "unknown", not "no classes"."""
    now = time.time()
    # Gated on WHEN we last tried, not on whether the result was non-empty —
    # while RLS returns 0 rows (or the project is down) an emptiness-based
    # check would re-fetch on every single dashboard load, putting an 8s
    # cross-project timeout in front of the page.
    if not force and _cache["at"] and now - _cache["at"] < settings.STAFF_DIRECTORY_TTL_SECONDS:
        return _cache["by_email"]

    try:
        by_email = _fetch()
        _cache.update({"at": now, "by_email": by_email, "ok": True})
        if not by_email:
            # 200 with no rows is what RLS-without-a-read-policy looks like,
            # so it's worth distinguishing from a transport error in the log.
            logger.warning("staff_roles returned 0 rows — is the anon read policy applied in that project?")
    except Exception as exc:
        _cache.update({"at": now, "ok": False})
        logger.warning("staff_roles unavailable (%s) — falling back to POW-derived classes", exc)

    return _cache["by_email"]


def assignments_for(email: str) -> list:
    return get_directory().get(_normalize(email), {}).get("assignments", [])


def subjects_for(email: str) -> list:
    """Every subject this person teaches, canonicalised. `users.subject` in the
    portal holds ONE subject, but real teachers have more — Ms Shilpi Rastogi
    teaches Science and English — so the POW form offers this list instead of
    locking them to the single stored value. Drawn from staff_roles' own
    `subjects` column and from the classes they're assigned."""
    entry = get_directory().get(_normalize(email))
    if not entry:
        return []
    out = []
    for name in list(entry["subjects"]) + [a["subject"] for a in entry["assignments"]]:
        canonical = canonical_subject(name)
        if canonical and canonical not in out:
            out.append(canonical)
    return out


def is_available() -> bool:
    return bool(get_directory())
