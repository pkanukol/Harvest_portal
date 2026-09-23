"""Read-only view of the CCQ (CCT) results, which live in the SAME separate
Supabase project as staff_roles (see config.STAFF_SUPABASE_URL).

`reports` holds one row per STUDENT per test. It contains TWO ERAS, and both
have to be handled because a POW can be filed against either:

  * session_id "SES_..."  — 25 May to 20 Aug 2026, ~10,000 rows. `class_avg_pct`
    is filled in, and 601 of its 634 sessions JOIN to `cct_sessions`, which is
    the authoritative source of branch/grade/section/subject/status.
  * session_id "CCQ|nnn"  — 6 Aug 2026 onward, ~10,100 rows, and what is being
    written today. `class_avg_pct` is NULL throughout and these ids appear in no
    `cct_sessions` row, so the section has to be read off `test_name` and the
    score averaged from the students' own `pct`.

So neither table alone is enough:

    section  = cct_sessions[session_id] when it joins, else the test_name prefix
    score    = class_avg_pct when present, else the mean of the students' pct

`test_name` encodes the class and the campus:

    "G7-F Chemistry_ The World of Metals and Non-Metals HISK - CCT_4"
     ^^^^                                                  ^^^^
     grade 7, section F                                    campus

A "G7-Group" prefix is a test sat by a combined group rather than a section; no
single section can claim it, so those rows are skipped rather than guessed at.

Nothing here writes. If the project is unreachable every function returns "no
results" and the POW screen says so, rather than failing.
"""
import re
import time
import logging
import httpx

from .config import settings
from .staff_directory import canonical_subject

logger = logging.getLogger("curriculum_tracker")

# Our subject names -> the subject_code values `reports` uses. The full set in
# the live table is MTH, CHM, SSC, PHY, BIO, KAN, HIN, SCI, GEO, ENG and BAS;
# BAS carries no grade or campus and is left out.
SUBJECT_CODES = {
    "mathematics": {"MTH"},
    "english": {"ENG"},
    "hindi": {"HIN"},
    "hindi (r3)": {"HIN"},
    "kannada": {"KAN"},
    # Geography is a Social Science discipline in the curriculum sheets; the CCQ
    # data codes it separately.
    "social science": {"SSC", "GEO"},
    "biology": {"BIO"},
    "physics": {"PHY"},
    "chemistry": {"CHM"},
    # The umbrella subject: lower grades sit "Science" tests, upper grades sit
    # the streams. A POW filed as Science should find either.
    "science": {"SCI", "BIO", "PHY", "CHM"},
}

_TEST_PREFIX = re.compile(r"^G\s*(\d{1,2})\s*-\s*([A-F])\b", re.I)
# "G8-Group Hindi_ ..." - two or more sections sat this one together, so the
# result belongs to the GRADE and no section can claim a share of it. Seen in
# Hindi at Attibele so far; English and Kannada joined the CCT recently and may
# come to use it too.
_GROUP_PREFIX = re.compile(r"^G\s*(\d{1,2})\s*-\s*Group\b", re.I)
# The key a grade-wide result is filed under, where a section would otherwise be.
GRADE_KEY = "*"

_CAMPUS_MARKERS = [("HISIC", "Attibele"), ("HISA", "Attibele"), ("HISK", "Kodathi")]

# A section at or above this is not asked to explain itself.
PASS_MARK = 70

# The CCT runs from Grade 5 up - confirmed with the APM, and borne out by the
# data: no subject_code has a single result below Grade 5. Under it a POW shows
# no CCQ block at all.
MIN_GRADE = 5

# cct_sessions is small (~1,200 rows) and changes rarely, so it is cached whole
# rather than queried per POW.
_CACHE = {"at": 0.0, "by_session": {}, "by_class": {}}
_TTL = 600


def codes_for(subject: str) -> set:
    return SUBJECT_CODES.get((subject or "").strip().lower(), set())


def campus_of(test_name: str, branch: str) -> str:
    """One campus name from three spellings ("Kodathi", "HIS Kodathi",
    "HISIC Attibele") plus the marker inside the test name."""
    for marker, campus in _CAMPUS_MARKERS:
        if marker in (test_name or "").upper():
            return campus
    text = (branch or "").lower()
    if "kodathi" in text:
        return "Kodathi"
    if "attibele" in text:
        return "Attibele"
    return (branch or "").strip()


def _clean_subject(name: str) -> str:
    """cct_sessions spells a subject several ways - "Math_", "Physics_NV",
    "Geography & Economics". canonical_subject handles the trailing underscore
    and the aliases; the _NV suffix is stripped first."""
    text = re.sub(r"_NV$", "", (name or "").strip(), flags=re.I)
    return canonical_subject(text)


def _headers() -> dict:
    key = settings.STAFF_SUPABASE_SERVICE_KEY or settings.STAFF_SUPABASE_ANON_KEY
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _sessions() -> tuple:
    """(by_session_id, by_class) from cct_sessions, cached.

    by_class is keyed (campus, grade, section, canonical subject) and holds the
    LATEST row for that class, which is what says whether a test was ever set
    up for it at all.
    """
    now = time.time()
    if _CACHE["at"] and now - _CACHE["at"] < _TTL:
        return _CACHE["by_session"], _CACHE["by_class"]

    by_session, by_class = {}, {}
    try:
        resp = httpx.get(
            f"{settings.STAFF_SUPABASE_URL}/rest/v1/cct_sessions",
            params={"select": "session_id,branch,grade,section,subject,status,"
                              "quality_test,test_id,form_name", "limit": "5000"},
            headers=_headers(),
            timeout=12,
        )
        resp.raise_for_status()
        for row in resp.json():
            campus = campus_of(row.get("form_name"), row.get("branch"))
            section = (row.get("section") or "").strip().upper()[:1]
            entry = {
                "campus": campus,
                "grade": row.get("grade"),
                "section": section,
                "subject": _clean_subject(row.get("subject")),
                "status": row.get("status") or "",
                "quality_test": row.get("quality_test") or "",
                "test_id": row.get("test_id") or "",
            }
            if row.get("session_id"):
                by_session[row["session_id"]] = entry
            if section and row.get("grade") is not None:
                by_class[(campus, str(row["grade"]), section, entry["subject"].lower())] = entry
    except Exception as exc:
        logger.warning("cct_sessions unavailable (%s) — falling back to test names", exc)

    _CACHE.update({"at": now, "by_session": by_session, "by_class": by_class})
    return by_session, by_class


def _fetch_reports(subject_codes: set, grade, start: str, end: str) -> list:
    resp = httpx.get(
        f"{settings.STAFF_SUPABASE_URL}/rest/v1/reports",
        params={
            "select": "session_id,branch,grade,subject_code,test_name,taken_on,"
                      "pct,class_avg_pct,cct_number",
            "grade": f"eq.{int(grade)}",
            "subject_code": f"in.({','.join(sorted(subject_codes))})",
            "taken_on": f"gte.{start}",
            "limit": "5000",
        },
        headers=_headers(),
        timeout=12,
    )
    resp.raise_for_status()
    # The upper bound is applied here: PostgREST cannot take the same column
    # twice in one query string.
    return [r for r in resp.json() if r.get("taken_on") and r["taken_on"] <= end]


def section_scores(subject: str, grade, branch: str, week_start: str, week_end: str) -> dict:
    """{section: {...}} for one class's CCQ in one week."""
    codes = codes_for(subject)
    if not codes or grade in (None, ""):
        return {}

    try:
        rows = _fetch_reports(codes, grade, week_start, week_end)
    except Exception as exc:
        logger.warning("CCQ results unavailable (%s) — treating as not conducted", exc)
        return {}

    by_session, _ = _sessions()
    want = (branch or "").strip().lower()

    buckets = {}
    for r in rows:
        linked = by_session.get(r.get("session_id"))
        name = r.get("test_name") or ""
        # A grouped test is checked FIRST: it is the grade's paper, and letting
        # a joined cct_sessions row name a section for it would hand the whole
        # grade's result to whichever section that row happened to mention.
        if _GROUP_PREFIX.match(name):
            section = GRADE_KEY
            campus = campus_of(name, r.get("branch"))
        elif linked and linked["section"]:
            # cct_sessions is authoritative where the session joins.
            section, campus = linked["section"], linked["campus"]
        else:
            m = _TEST_PREFIX.match(name)
            if not m:
                continue                  # names neither a section nor a grade
            section = m.group(2).upper()
            campus = campus_of(name, r.get("branch"))

        if want and campus and campus.lower() != want:
            continue

        entry = buckets.setdefault(section, {
            "section": section,
            "test_name": r.get("test_name") or "",
            "taken_on": r.get("taken_on"),
            "cct_number": r.get("cct_number"),
            "status": (linked or {}).get("status", ""),
            "class_avg": None,
            "_pcts": [],
        })
        if r.get("class_avg_pct") is not None:
            entry["class_avg"] = float(r["class_avg_pct"])
        if r.get("pct") is not None:
            entry["_pcts"].append(float(r["pct"]))
        if (r.get("taken_on") or "") > (entry["taken_on"] or ""):
            entry.update(test_name=r.get("test_name") or "", taken_on=r.get("taken_on"))

    out = {}
    for section, entry in buckets.items():
        pcts = entry.pop("_pcts")
        avg = entry.pop("class_avg")
        # The CCT system's own class average where it recorded one; the mean of
        # the students' scores otherwise. The current "CCQ|" era leaves
        # class_avg_pct NULL on every row, so most weeks take the second path.
        if avg is None:
            if not pcts:
                continue
            avg = sum(pcts) / len(pcts)
        entry["pct"] = round(avg)
        entry["students"] = len(pcts)
        entry["below"] = entry["pct"] < PASS_MARK
        out[section] = entry
    return out


def scheduled_sessions(subject: str, grade, branch: str, sections: list) -> dict:
    """{section: cct_sessions entry} for the classes that HAVE a test set up,
    whatever its date - so a section with no result can be told apart: one that
    was scheduled and has not sat it yet, from one nobody ever set a test for.
    """
    _, by_class = _sessions()
    wanted = _clean_subject(subject).lower()
    campus = (branch or "").strip()
    out = {}
    for section in sections:
        entry = by_class.get((campus, str(grade), section, wanted))
        if entry:
            out[section] = entry
    return out
