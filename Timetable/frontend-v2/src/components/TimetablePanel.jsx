import { useEffect, useRef, useState } from "react";
import UploadTimetable from "./UploadTimetable";
import TimetableViewer from "./TimetableViewer";
import TeacherTimetableView from "./TeacherTimetableView";
import ResourceTimetableView from "./ResourceTimetableView";
import ZeroPeriodPanel from "./ZeroPeriodPanel";

// pendingView/onCommitted: a successful commit from either Upload (inside
// this panel) or Build New (a separate top-level tab in App.jsx) should land
// the user on that year's timetable automatically - confirmed by the user
// 2026-08-04 ("if saved [the] control goes to view timetable automatically").
// Both entry points call the SAME onCommitted (passed down from App.jsx),
// which also flips App's own top-level tab to "Timetable"; this panel just
// watches pendingView to switch its own internal mode to "view" once that
// happens, so one mechanism covers both callers. pendingView is always a
// FRESH {academicYearId} object per commit (see App.jsx) - comparing by
// object identity (not the id value) means committing to the SAME year
// twice in one session still triggers this every time.
export default function TimetablePanel({ client, branch, canEdit, pendingView, onCommitted }) {
  const [mode, setMode] = useState(null); // null | "upload" | "view" | "teacher" | "resource" | "zero"
  const [viewYearId, setViewYearId] = useState(null);
  const appliedPendingRef = useRef(null);

  useEffect(() => {
    if (!pendingView) return;
    if (appliedPendingRef.current === pendingView) return;
    appliedPendingRef.current = pendingView;
    setViewYearId(pendingView.academicYearId);
    setMode("view");
  }, [pendingView]);

  if (!branch) return <p>Select a branch above.</p>;

  return (
    <section>
      <div className="no-print">
        {/* Upload is the v1 "Import" surface - leadership only. */}
        {canEdit && (
          <>
            <button onClick={() => setMode("upload")} disabled={mode === "upload"}>
              Upload new timetable
            </button>{" "}
          </>
        )}
        <button onClick={() => setMode("view")} disabled={mode === "view"}>
          View timetable
        </button>{" "}
        <button onClick={() => setMode("teacher")} disabled={mode === "teacher"}>
          View teacher timetable
        </button>{" "}
        <button onClick={() => setMode("resource")} disabled={mode === "resource"}>
          Resource timetable
        </button>{" "}
        <button onClick={() => setMode("zero")} disabled={mode === "zero"}>
          Zero timetable
        </button>
      </div>

      {mode === "upload" && canEdit && (
        <UploadTimetable client={client} branch={branch} onCommitted={onCommitted} />
      )}
      {mode === "view" && (
        <TimetableViewer client={client} branch={branch} canEdit={canEdit} initialYearId={viewYearId} />
      )}
      {mode === "teacher" && <TeacherTimetableView client={client} branch={branch} />}
      {mode === "resource" && <ResourceTimetableView client={client} branch={branch} />}
      {mode === "zero" && <ZeroPeriodPanel client={client} branch={branch} canEdit={canEdit} />}
    </section>
  );
}
