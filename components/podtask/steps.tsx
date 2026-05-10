import { cn } from "@/lib/utils";
import { CheckIcon } from "./icons";

interface StepsProps {
  current: number;
  items: string[];
  className?: string;
}

export function Steps({ current, items, className }: StepsProps) {
  return (
    <div className={cn("steps", className)}>
      {items.map((label, i) => {
        const state =
          i < current ? "done" : i === current ? "active" : "pending";
        return (
          <div key={label} className="contents">
            {i > 0 && (
              <div
                className="step-line"
                style={{
                  background:
                    i <= current
                      ? "linear-gradient(90deg, #7DD3FC, #FDA4AF)"
                      : undefined,
                }}
              />
            )}
            <div className={cn("step", state === "active" && "active", state === "done" && "done")}>
              <div className="step-num">
                {state === "done" ? <CheckIcon size={14} /> : i + 1}
              </div>
              <div className="step-label">{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
