"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/components/providers/theme-provider";
import { THEMES, THEME_SWATCH, type ThemeId } from "@/lib/theme/config";
import { CheckIcon, PaletteIcon } from "./icons";
import { cn } from "@/lib/utils";

/** The bar that holds the switcher re-renders in the new theme, so the
 *  focused control is replaced; this flag hands focus to its successor. */
export const THEME_FOCUS_KEY = "pt_theme_focus";

export function rememberThemeFocus(target: "switcher" | "chooser") {
  try {
    sessionStorage.setItem(THEME_FOCUS_KEY, `${target}:${Date.now()}`);
  } catch {
    /* storage blocked: focus simply returns to the page */
  }
}

export function takeThemeFocus(target: "switcher" | "chooser"): boolean {
  try {
    const [stored, at] = (sessionStorage.getItem(THEME_FOCUS_KEY) ?? "").split(":");
    if (stored !== target) return false;
    sessionStorage.removeItem(THEME_FOCUS_KEY);
    // Only the control mounted right after the switch takes focus.
    return Date.now() - Number(at) < 5000;
  } catch {
    return false;
  }
}

interface ThemeSwitcherProps {
  /** Classes for the trigger button, so it matches the bar it sits in. */
  className?: string;
  /** Show the text label next to the icon (hidden on narrow screens by CSS). */
  showLabel?: boolean;
  /** Open the menu upwards (for triggers at the bottom of a sidebar). */
  placement?: "down" | "up";
}

/** Menu button that picks the visual theme (WAI-ARIA menu button pattern). */
export function ThemeSwitcher({ className, showLabel = true, placement = "down" }: ThemeSwitcherProps) {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  // A switch made from this control re-renders the bar: refocus the new trigger.
  useEffect(() => {
    if (takeThemeFocus("switcher")) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // Focus the current theme's item when the menu opens.
    itemRefs.current[Math.max(0, THEMES.indexOf(theme))]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, theme]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (id: ThemeId) => {
    if (id === theme) {
      close(true);
      return;
    }
    rememberThemeFocus("switcher");
    setOpen(false);
    setTheme(id);
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => Boolean(el));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className="theme-switcher" ref={rootRef} data-placement={placement}>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("label")}
        title={t("label")}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <PaletteIcon size={16} />
        {showLabel ? <span className="nav-pill-label">{t("short")}</span> : null}
      </button>
      {open ? (
        <div className="theme-menu" role="menu" id={menuId} aria-label={t("label")} onKeyDown={onMenuKeyDown}>
          {THEMES.map((id, i) => {
            const selected = id === theme;
            const [bg, accent] = THEME_SWATCH[id];
            return (
              <button
                key={id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                className={cn("theme-menu-item", selected && "selected")}
                onClick={() => choose(id)}
              >
                <span className="theme-swatch" aria-hidden style={{ background: bg }}>
                  <span style={{ background: accent }} />
                </span>
                <span className="theme-menu-name">{t(`names.${id}`)}</span>
                {selected ? <CheckIcon size={14} className="theme-menu-check" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
