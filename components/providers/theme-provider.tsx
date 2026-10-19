"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  isThemeId,
  type ThemeId,
} from "@/lib/theme/config";

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "classic",
  setTheme: () => {},
});

/**
 * Holds the active theme. The root layout reads the cookie and passes it in,
 * so the first render is already right. Switching writes the cookie, flips
 * `<html data-theme>` at once (CSS-only differences repaint immediately) and
 * refreshes the server components (layout differences follow).
 *
 * `?theme=<id>` in any URL switches too, which makes a theme easy to share.
 */
export function ThemeProvider({ initial, children }: { initial: ThemeId; children: ReactNode }) {
  const router = useRouter();
  const [theme, setThemeState] = useState<ThemeId>(initial);
  // Follow the server: after a refresh the layout passes the cookie's theme.
  const [prevInitial, setPrevInitial] = useState<ThemeId>(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setThemeState(initial);
  }

  /** Persist the choice and re-render the server parts in it. */
  const applyTheme = useCallback(
    (next: ThemeId) => {
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
      document.documentElement.dataset.theme = next;
      router.refresh();
    },
    [router],
  );

  const setTheme = useCallback(
    (next: ThemeId) => {
      applyTheme(next);
      setThemeState(next);
    },
    [applyTheme],
  );

  useEffect(() => {
    // `?theme=` only on first load; the state follows through `initial`
    // once the refresh lands. Later navigations keep the visitor's pick.
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    if (isThemeId(fromUrl) && fromUrl !== initial) applyTheme(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
