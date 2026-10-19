"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/components/providers/theme-provider";
import { THEMES, THEME_SWATCH } from "@/lib/theme/config";
import { CheckIcon, PaletteIcon } from "./icons";
import { cn } from "@/lib/utils";

interface ThemeSwitcherProps {
  /** Classes for the trigger button, so it matches the bar it sits in. */
  className?: string;
  /** Show the text label next to the icon (hidden on narrow screens by CSS). */
  showLabel?: boolean;
  /** Open the menu upwards (for triggers at the bottom of a sidebar). */
  placement?: "down" | "up";
}

/** Button + small menu that picks the visual theme. */
export function ThemeSwitcher({ className, showLabel = true, placement = "down" }: ThemeSwitcherProps) {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="theme-switcher" ref={rootRef} data-placement={placement}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("label")}
        title={t("label")}
        onClick={() => setOpen((v) => !v)}
      >
        <PaletteIcon size={16} />
        {showLabel ? <span className="nav-pill-label">{t("short")}</span> : null}
      </button>
      {open ? (
        <div className="theme-menu" role="menu" id={menuId} aria-label={t("label")}>
          {THEMES.map((id) => {
            const selected = id === theme;
            const [bg, accent] = THEME_SWATCH[id];
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={cn("theme-menu-item", selected && "selected")}
                onClick={() => {
                  setOpen(false);
                  if (!selected) setTheme(id);
                }}
              >
                <span className="theme-swatch" aria-hidden style={{ background: bg }}>
                  <span style={{ background: accent }} />
                </span>
                <span className="theme-menu-name">{t(`names.${id}`)}</span>
                {selected ? <CheckIcon size={14} className="theme-menu-check" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
