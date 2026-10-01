import type { ReactNode } from "react";
import { Blobs } from "@/components/podtask/blobs";
import { TopBar } from "@/components/podtask/top-bar";

interface StudentAppShellProps {
  children: ReactNode;
  studentInitial?: string;
  blobsVariant?: "default" | "studio";
}

/**
 * Shared frame for every student screen except login and the live interview
 * room (those render their own chrome): background blobs + top bar + content.
 */
export function StudentAppShell({
  children,
  studentInitial = "מ",
  blobsVariant = "default",
}: StudentAppShellProps) {
  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs variant={blobsVariant} />
      <TopBar studentInitial={studentInitial} />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
