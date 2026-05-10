import { getRequestConfig } from "next-intl/server";
import { defaultLocale, type Locale, locales } from "./config";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = (await requestLocale) ?? defaultLocale;
  const locale = (locales as readonly string[]).includes(requested)
    ? (requested as Locale)
    : defaultLocale;

  const messages = (await import(`./messages/${locale}.json`)).default;
  return {
    locale,
    messages,
  };
});

export { locales, defaultLocale };
