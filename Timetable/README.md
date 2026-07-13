# Timetable

Turns the yearly `WORK ALLOTMENT.xlsx` + period-timing schedule into an editable, conflict-checked
weekly timetable for Grades 1–10.

## Running locally

First-time setup (backend uses a venv, like AuditApp):

```
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env   REM then fill in DATABASE_URL and SECRET_KEY
```

Then double-click `start.bat`, or run manually:

```
cd backend && venv\Scripts\python -m uvicorn app.main:app --reload --port 8010
cd frontend && npm run dev
```

`DATABASE_URL` is the same Supabase Postgres project as AuditApp/the portal.

This app has no login screen of its own — open it through the school portal
(`http://localhost:3000/portal` locally, or the portal's production URL), which hands off a
Supabase session token via `?sso=...`.

## Access control

Timetable reuses the portal's existing Supabase `users` table for identity — no changes to that
table's `role` column are needed or made. Instead, access level is computed from the existing
`designation` field (see `LEADERSHIP_DESIGNATION_KEYWORDS` in `backend/app/auth.py`):

- **Leadership access** (Import / Generate / Edit): anyone whose `designation` contains "vice
  principal", "block head", "coordinator", "principal", "managing director", "chairman", or "apm"
  (case-insensitive).
- **View access** (read-only browsing, plus "My Week" if linked): everyone else with a valid portal
  account (SME, HOD, Teacher, etc.).

One remaining one-time step: in Timetable's **Teachers** tab (leadership only), link each teacher's
row to their school email, so their login resolves to their own weekly schedule under "My Week".
The workbook has no emails, so this can't be inferred automatically.

## Yearly re-import

Each year, use the **Import** tab to upload the new `WORK ALLOTMENT.xlsx` and timing file. It shows
a preview (grade totals, unmatched teachers, warnings) before anything is committed. Committing
creates a new academic year and makes it active — the previous year's data stays in the database.
Then use **Generate** to auto-fill the grid, and fix anything flagged directly in the Timetable tab.
