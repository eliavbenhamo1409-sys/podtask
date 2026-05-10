export const locales = ["he", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "he";

export const localeMeta: Record<
  Locale,
  { label: string; dir: "rtl" | "ltr"; flag: string }
> = {
  he: { label: "עברית", dir: "rtl", flag: "IL" },
  en: { label: "English", dir: "ltr", flag: "US" },
};
