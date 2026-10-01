import { StudentAppShell } from "@/components/student/student-app-shell";

/**
 * Route-level loading state for the student screens: the shell stays put and
 * the content area shows a quiet skeleton instead of a blank page.
 */
export default function StudentLoading() {
  return (
    <StudentAppShell>
      <div className="page" role="status" aria-busy="true">
        <div className="skeleton" style={{ width: 120, height: 14 }} />
        <div
          className="skeleton"
          style={{ width: "min(520px, 80%)", height: 44, marginTop: 18 }}
        />
        <div
          className="skeleton"
          style={{ width: "min(420px, 60%)", height: 16, marginTop: 14 }}
        />
        <div
          className="skeleton"
          style={{ height: 260, marginTop: 40, borderRadius: 32 }}
        />
        <div className="grid-cards" style={{ marginTop: 32 }}>
          <div className="skeleton" style={{ height: 180, borderRadius: 32 }} />
          <div className="skeleton" style={{ height: 180, borderRadius: 32 }} />
        </div>
      </div>
    </StudentAppShell>
  );
}
