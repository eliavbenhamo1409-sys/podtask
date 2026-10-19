"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ForestTab {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Small count after the label (e.g. items to check). */
  count?: number;
  content: ReactNode;
}

/**
 * Tabs for the forest interview review. Every panel stays mounted (hidden
 * when inactive) so find-in-page and printing still see the whole report.
 */
export function ForestTabs({ label, tabs }: { label: string; tabs: ForestTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0) return;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let next = -1;
    if (e.key === "ArrowRight") next = rtl ? i - 1 : i + 1;
    else if (e.key === "ArrowLeft") next = rtl ? i + 1 : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    next = (next + tabs.length) % tabs.length;
    setActive(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div className="lxf-tabs">
      <div className="lxf-tablist" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={cn("lxf-tab", selected && "active")}
              onClick={() => setActive(tab.id)}
            >
              {tab.icon ? (
                <span className="lxf-tab-icon" aria-hidden>
                  {tab.icon}
                </span>
              ) : null}
              <span>{tab.label}</span>
              {typeof tab.count === "number" && tab.count > 0 ? (
                <span className="lxf-tab-count">{tab.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== active}
          className="lxf-tabpanel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
