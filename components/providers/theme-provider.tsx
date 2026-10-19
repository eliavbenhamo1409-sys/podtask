"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  isLiveRoomPath,
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
 * The live interview room is never refreshed or switched (see isLiveRoomPath).
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
      if (!isLiveRoomPath(window.location.pathname)) router.refresh();
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
    if (isLiveRoomPath(window.location.pathname)) return;
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    if (isThemeId(fromUrl) && fromUrl !== initial) applyTheme(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Another tab may have switched the theme (same cookie): catch up when
    // this tab is shown again, so its client and server parts never mix.
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      if (isLiveRoomPath(window.location.pathname)) return;
      const fromCookie = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${THEME_COOKIE}=`))
        ?.slice(THEME_COOKIE.length + 1);
      if (!isThemeId(fromCookie) || fromCookie === theme) return;
      document.documentElement.dataset.theme = fromCookie;
      setThemeState(fromCookie);
      router.refresh();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [theme, router]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
