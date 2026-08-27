"""Fill in the reviewer chain in bulk, from the org's actual rules:

  * teachers, HODs and coordinators -> the principal of their branch
  * SMEs                            -> the Managing Director
  * curriculum heads, DLP manager, APM, IT/admin staff, and the principals
    themselves                      -> the Managing Director

Doing this one dropdown at a time is 125 edits; this does it in one pass.

SAFE BY DEFAULT, in three ways:
  1. Dry run unless you pass --apply, so you always see the plan first.
  2. It NEVER changes a person who already has a reviewer set. Anything you
     picked by hand on the Reviewer assignments screen survives every re-run.
     Pass --overwrite only if you deliberately want the rules to win.
  3. It only ever writes to `reviewer_assignments` (a GoalTracker-owned
     table). It never touches `users` / `teacher_sme`, which AuditApp owns
     and which hold live staff records.

Usage (from GoalTracker/backend):

    python assign_reviewers.py                 # show the plan, change nothing
    python assign_reviewers.py --apply         # fill in only the blanks
    python assign_reviewers.py --apply --overwrite   # rules win everywhere

Against production, point DATABASE_URL at Supabase for the run:

    DATABASE_URL="postgresql://...  " python assign_reviewers.py
"""
import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app import crud, models

MD = "abhinav_g@harvestinternationalschool.in"

# The branch lives in the principal's address, not in `location` - both
# principals are recorded as location "Both", so matching on that would be
# ambiguous. Teachers' `location` is the reliable side of the mapping.
BRANCH_PRINCIPAL = {
    "kodathi": "principal.kodathi@harvestinternationalschool.in",
    "attibele": "principal.attibele@harvestinternationalschool.in",
}

# Everyone in this tier reports to the MD for goal review.
# HODs and coordinators report to their branch principal, like teachers -
# matched on designation rather than role because one HOD is recorded with
# role='auditor' rather than 'sme', and would otherwise be missed.
TO_BRANCH_PRINCIPAL_DESIGNATIONS = {"hod", "coordinator"}

TO_MD_DESIGNATIONS = {
    "curriculum head", "dlp manager", "apm", "vice principal",
    "it manager", "information technology", "principal",
}

# Nobody above the MD gets a reviewer: the MD himself, and the Chairman.
NO_REVIEWER_DESIGNATIONS = {"managing director", "chairman"}


def intended_reviewer(user) -> tuple:
    """(reviewer_email, why) for one person; (None, why) to leave them alone."""
    role = (user.role or "").strip().lower()
    desig = (user.designation or "").strip().lower()
    loc = (user.location or "").strip().lower()

    if desig in NO_REVIEWER_DESIGNATIONS:
        return None, "top of the chain - no reviewer"

    if role == "teacher" or desig in TO_BRANCH_PRINCIPAL_DESIGNATIONS:
        principal = BRANCH_PRINCIPAL.get(loc)
        what = user.designation or user.role
        if not principal:
            # "Both" or blank: no single branch principal is correct, so this
            # is a judgement call for a human rather than a guess.
            return None, f"{what} with location {user.location!r} - needs a manual pick"
        return principal, f"{what} at {user.location} -> branch principal"

    if role == "sme":
        return MD, "SME -> Managing Director"

    if desig in TO_MD_DESIGNATIONS:
        return MD, f"{user.designation} -> Managing Director"

    return None, f"no rule for role={user.role!r} designation={user.designation!r}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    ap.add_argument("--overwrite", action="store_true",
                    help="also replace reviewers that are already set (default: only fill blanks)")
    ap.add_argument("--overwrite-teachers", action="store_true",
                    help="enforce the branch-principal rule for teachers even where a reviewer "
                         "is already set, leaving everyone else's manual assignments alone")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        users = crud.get_all_org_users(db)
        existing = {a.person_email.lower(): a for a in db.query(models.ReviewerAssignment).all()}

        to_write, kept, skipped = [], [], []
        for u in sorted(users, key=lambda x: (x.designation or "", x.name or "")):
            reviewer, why = intended_reviewer(u)
            current = existing.get(u.email.lower())
            current_reviewer = current.reviewer_email if current else None

            if reviewer is None:
                skipped.append((u, why))
                continue
            # Teachers follow their branch principal by rule; --overwrite-teachers
            # re-points ones assigned to someone else (e.g. an HOD) without
            # disturbing manual choices anywhere else in the chain.
            force = args.overwrite or (args.overwrite_teachers and (u.role or "").strip().lower() == "teacher")
            if current_reviewer and not force:
                kept.append((u, current_reviewer))
                continue
            if current_reviewer and current_reviewer.lower() == reviewer.lower():
                kept.append((u, current_reviewer))
                continue
            to_write.append((u, reviewer, why, current_reviewer))

        print(f"{'APPLYING' if args.apply else 'DRY RUN - nothing will be written'}\n")
        print(f"people: {len(users)}")
        print(f"  to set:            {len(to_write)}")
        print(f"  already set, kept: {len(kept)}" + ("" if not args.overwrite else " (overwrite on)"))
        print(f"  no rule / skipped: {len(skipped)}\n")

        print("--- planned changes, grouped by reviewer ---")
        by_reviewer = Counter(r for _, r, _, _ in to_write)
        for reviewer, count in by_reviewer.most_common():
            print(f"  {reviewer:<52} {count} people")

        if skipped:
            print("\n--- left alone (needs a human decision) ---")
            for u, why in skipped:
                print(f"  {u.name:<32} {str(u.designation):<22} {why}")

        if (args.overwrite or args.overwrite_teachers) and to_write:
            changes = [(u, r, cur) for u, r, _, cur in to_write if cur]
            if changes:
                print(f"\n--- {len(changes)} EXISTING reviewer(s) would be REPLACED ---")
                for u, r, cur in changes:
                    print(f"  {u.name:<32} {cur} -> {r}")

        if not args.apply:
            print("\nRe-run with --apply to write these.")
            return

        for u, reviewer, _, _ in to_write:
            crud.upsert_assignment(db, u.email, reviewer, updated_by="assign_reviewers.py")
        print(f"\nDone. {len(to_write)} assignment(s) written.")
        print("Change any of them any time on the Reviewer assignments screen - "
              "re-running this script will not undo your edits unless you pass --overwrite.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
