import type { ReactNode } from "react";
import { Blobs } from "@/components/podtask/blobs";
import { TopBar } from "@/components/podtask/top-bar";

interface StudentAppShellProps {
  children: ReactNode;
  studentInitial?: string;
  blobsVariant?: "default" | "studio";
  hideTopBar?: boolean;
}

export function StudentAppShell({
  children,
  studentInitial = "מ",
  blobsVariant = "default",
  hideTopBar,
}: StudentAppShellProps) {
  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs variant={blobsVariant} />
      {!hideTopBar && <TopBar studentInitial={studentInitial} />}
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
