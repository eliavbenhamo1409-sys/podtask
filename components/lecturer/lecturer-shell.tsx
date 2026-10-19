import type { ReactNode } from "react";
import { Blobs } from "@/components/podtask/blobs";
import { getTheme } from "@/lib/theme/server";
import { LecturerTopBar } from "./lecturer-top-bar";
import { ForestLecturerShell } from "./forest/shell";
import type { Crumb } from "./forest/util";

interface LecturerShellProps {
  children: ReactNode;
  initial?: string;
  /** Breadcrumbs for the forest top bar (the classic bar has none). */
  crumbs?: Crumb[];
}

/** Frame of every lecturer screen: blobs, the lecturer top bar, content. */
export async function LecturerShell({ children, initial, crumbs }: LecturerShellProps) {
  if ((await getTheme()) === "forest") {
    return <ForestLecturerShell crumbs={crumbs}>{children}</ForestLecturerShell>;
  }
  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs />
      <LecturerTopBar initial={initial} />
      <main style={{ position: "relative", zIndex: 1 }}>{children}</main>
    </div>
  );
}
