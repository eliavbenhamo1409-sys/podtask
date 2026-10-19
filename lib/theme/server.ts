import { cookies } from "next/headers";
import { THEME_COOKIE, resolveTheme, type ThemeId } from "./config";

/** The visitor's theme, for server components and the root layout. */
export async function getTheme(): Promise<ThemeId> {
  const store = await cookies();
  return resolveTheme(store.get(THEME_COOKIE)?.value);
}
