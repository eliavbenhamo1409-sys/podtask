import { StudentAppShell } from "@/components/student/student-app-shell";

/**
 * Route-level loading state for the student screens: the shell stays put and
 * the content area shows a quiet skeleton instead of a blank page.
 * The skel-* classes are hooks for the forest theme (auth.css); the classic
 * look comes from .skeleton and the inline sizes alone.
 */
export default function StudentLoading() {
  return (
    <StudentAppShell>
      <div className="page skel-page" role="status" aria-busy="true">
        <div className="skeleton skel-line skel-eyebrow" style={{ width: 120, height: 14 }} />
        <div
          className="skeleton skel-line skel-heading"
          style={{ width: "min(520px, 80%)", height: 44, marginTop: 18 }}
        />
        <div
          className="skeleton skel-line"
          style={{ width: "min(420px, 60%)", height: 16, marginTop: 14 }}
        />
        <div
          className="skeleton skel-block skel-band"
          style={{ height: 260, marginTop: 40, borderRadius: 32 }}
        />
        <div className="grid-cards skel-grid" style={{ marginTop: 32 }}>
          <div className="skeleton skel-block" style={{ height: 180, borderRadius: 32 }} />
          <div className="skeleton skel-block" style={{ height: 180, borderRadius: 32 }} />
        </div>
      </div>
    </StudentAppShell>
  );
}
