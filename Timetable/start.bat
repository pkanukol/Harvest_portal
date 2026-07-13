@echo off
REM Launches the Timetable backend + frontend and opens it in the browser.
REM Double-click this file to run Timetable locally.

echo Starting Timetable backend on http://localhost:8010 ...
start "Timetable Backend" cmd /k "cd backend && venv\Scripts\python -m uvicorn app.main:app --reload --port 8010"

echo Starting Timetable frontend on http://localhost:5174 ...
start "Timetable Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 4 /nobreak >nul
start http://localhost:5174

echo.
echo Timetable is starting in two new windows (backend + frontend).
echo Close those windows to stop it. This app is normally opened via the
echo school portal (for login) - use http://localhost:3000/portal for that.
pause
