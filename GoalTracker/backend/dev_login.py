"""
Local-only helper: mints a GoalTracker JWT for one of the seeded users
(see seed.py) and prints a browser-console snippet that logs you in as them
without going through real Supabase SSO (which only works for real school
Google accounts, not the fake seed.py addresses).

Usage:
    python dev_login.py teacher.one@harvestinternationalschool.in
    python dev_login.py hod.math@harvestinternationalschool.in
    python dev_login.py curriculumhead@harvestinternationalschool.in

Then paste the printed snippet into the browser's DevTools console on the
GoalTracker frontend tab and press Enter.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app import crud, auth

if len(sys.argv) != 2:
    print(__doc__)
    sys.exit(1)

email = sys.argv[1].strip().lower()
db = SessionLocal()
user = crud.get_user_by_email(db, email)
db.close()

if not user:
    print(f"No seeded user with email {email!r}. Run `python seed.py` first, or check the address.")
    sys.exit(1)

is_admin = auth.role_is_leadership(user.role) or auth.designation_is_leadership(user.designation)

token = auth.create_access_token(data={
    "sub": user.email, "name": user.name, "designation": user.designation, "is_admin": is_admin,
})

print(f"\nLogging in as {user.name} <{user.email}> — designation: {user.designation}, admin: {is_admin}\n")
print("Paste this into the browser console on the GoalTracker tab:\n")
print(
    "localStorage.setItem('token', %r); "
    "localStorage.setItem('user', JSON.stringify(%s)); "
    "location.reload();"
    % (
        token,
        {
            "name": user.name, "email": user.email, "is_admin": is_admin,
            "designation": user.designation, "location": user.location,
        },
    )
)
print()
