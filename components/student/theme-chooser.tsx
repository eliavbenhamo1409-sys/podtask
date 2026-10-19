"use client";

import { useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/components/providers/theme-provider";
import { THEMES, THEME_SWATCH, type ThemeId } from "@/lib/theme/config";
import { CheckIcon } from "@/components/podtask/icons";

/**
 * Theme cards for the profile page: a radio group (arrow keys move and pick),
 * styled by `.theme-cards` / `.theme-card` in styles/themes/switcher.css.
 */
export function ThemeChooser() {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const pick = (id: ThemeId) => {
    if (id !== theme) setTheme(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const current = THEMES.indexOf(theme);
    const next = (current + step + THEMES.length) % THEMES.length;
    refs.current[next]?.focus();
    pick(THEMES[next]);
  };

  return (
    <div className="theme-cards" role="radiogroup" aria-label={t("label")} onKeyDown={onKeyDown}>
      {THEMES.map((id, i) => {
        const selected = id === theme;
        const [bg, accent] = THEME_SWATCH[id];
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="theme-card"
            onClick={() => pick(id)}
          >
            <span className="theme-swatch" aria-hidden style={{ background: bg }}>
              <span style={{ background: accent }} />
            </span>
            <span className="theme-card-name" style={{ flex: 1, minWidth: 0 }}>
              {t(`names.${id}`)}
            </span>
            {selected ? <CheckIcon size={14} className="theme-card-check" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
