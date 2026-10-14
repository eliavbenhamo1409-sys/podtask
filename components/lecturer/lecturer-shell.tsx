import type { ReactNode } from "react";
import { Blobs } from "@/components/podtask/blobs";
import { LecturerTopBar } from "./lecturer-top-bar";

interface LecturerShellProps {
  children: ReactNode;
  initial?: string;
}

/** Frame of every lecturer screen: blobs, the lecturer top bar, content. */
export function LecturerShell({ children, initial }: LecturerShellProps) {
  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs />
      <LecturerTopBar initial={initial} />
      <main style={{ position: "relative", zIndex: 1 }}>{children}</main>
    </div>
  );
}
