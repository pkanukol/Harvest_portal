"""
Seeds GoalTracker's OWN tables only - never the shared `users`/`teacher_sme`
tables (those are owned by AuditApp and, in production, hold live real data
that this script must never touch, drop, or recreate).

Both drop_all and create_all below are explicitly scoped to GoalTracker-owned
table objects (see GOALTRACKER_TABLES) - `models.User` and `models.TeacherSme`
are deliberately excluded from that list, so this script is structurally
incapable of affecting those tables no matter what DATABASE_URL it's pointed
at. It seeds nothing but a `ReviewerAssignment` chain (GoalTracker's own
table, no foreign key into `users` - it just stores email strings).

Note: this script does NOT create any `users` rows. If you're testing
locally against an empty SQLite file, `/api/auth/sso` and `dev_login.py` will
have no account to resolve until the `users` table has real data - either
point DATABASE_URL at a database that already has AuditApp's real roster, or
ask for a separate, clearly-labelled local-only identity fixture script.

Usage: python seed.py
WARNING: drops and recreates GoalTracker's own tables - existing Goal/
ReviewerAssignment/etc. data in whatever DB you're pointed at is lost.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.database import engine, SessionLocal, Base
from app import models

GOALTRACKER_TABLES = [
    models.ReviewerAssignment.__table__,
    models.Goal.__table__,
    models.GoalLog.__table__,
    models.GoalReviewAction.__table__,
    models.GoalFlagNotification.__table__,
]

print("Dropping GoalTracker-owned tables only (never users/teacher_sme)...")
Base.metadata.drop_all(bind=engine, tables=GOALTRACKER_TABLES)
print("Recreating GoalTracker-owned tables only...")
Base.metadata.create_all(bind=engine, tables=GOALTRACKER_TABLES)

# ─── Illustrative reviewer/acknowledger chain ───────────────────────────────
# Email strings only - this table has no foreign key into `users`, so these
# rows don't require (and don't create) any matching User row. Not a
# verified real org chart - one example path to exercise the workflow.
# (person_email, reviewer_email, acknowledger_email)
ASSIGNMENTS = [
    ("chitralekha@harvestinternationalschool.in", "timsy.thomas@harvestinternationalschool.in", None),
    ("timsy.thomas@harvestinternationalschool.in", "chitra@harvestinternationalschool.in", "principal.kodathi@harvestinternationalschool.in"),
    ("chitra@harvestinternationalschool.in", "abhinav_g@harvestinternationalschool.in", "principal.kodathi@harvestinternationalschool.in"),
    ("tharunnya@harvestinternationalschool.in", "principal.kodathi@harvestinternationalschool.in", None),
    ("sumathi@harvestinternationalschool.in", "principal.kodathi@harvestinternationalschool.in", None),
    ("guru@harvestinternationalschool.in", "abhinav_g@harvestinternationalschool.in", None),
    ("pavani.k@harvestinternationalschool.in", "abhinav_g@harvestinternationalschool.in", None),
    ("principal.kodathi@harvestinternationalschool.in", "abhinav_g@harvestinternationalschool.in", "abhinav_g@harvestinternationalschool.in"),
    ("abhinav_g@harvestinternationalschool.in", None, "ram@harvestinternationalschool.in"),
    ("ram@harvestinternationalschool.in", None, None),
]


def seed():
    db = SessionLocal()
    try:
        for person_email, reviewer_email, acknowledger_email in ASSIGNMENTS:
            db.add(models.ReviewerAssignment(
                person_email=person_email.lower(),
                reviewer_email=(reviewer_email.lower() if reviewer_email else None),
                acknowledger_email=(acknowledger_email.lower() if acknowledger_email else None),
                updated_by="seed.py",
            ))
        db.commit()
        print(f"Added {len(ASSIGNMENTS)} illustrative reviewer/acknowledger assignments.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
