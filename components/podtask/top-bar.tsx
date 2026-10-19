"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getCachedProfileInitial } from "@/lib/student/profile-initial";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { useTheme } from "@/components/providers/theme-provider";
import { BrandMark } from "./brand-mark";
import { ThemeSwitcher } from "./theme-switcher";
import { ClockIcon, GlobeIcon, GridIcon, HomeIcon, QuestionIcon } from "./icons";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";

interface TopBarProps {
  studentInitial?: string;
}

const NAV = [
  { href: "/student", key: "nav.dashboard", Icon: HomeIcon, prefixes: ["/student/assignments"] },
  { href: "/student/history", key: "nav.history", Icon: ClockIcon, prefixes: [] },
  { href: "/student/help", key: "nav.help", Icon: QuestionIcon, prefixes: [] },
] as const;

export function TopBar({ studentInitial }: TopBarProps) {
  const t = useTranslations();
  const { theme } = useTheme();
  // Pages that already have the profile pass the initial; everything else
  // resolves it here so the avatar never shows a placeholder letter.
  const [fetchedInitial, setFetchedInitial] = useState("");
  const initial = studentInitial ?? fetchedInitial;
  useEffect(() => {
    if (studentInitial) return;
    let cancelled = false;
    getCachedProfileInitial()
      .then((initial) => {
        if (!cancelled) setFetchedInitial(initial);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [studentInitial]);
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale() as Locale;

  const otherLocale: Locale = locale === "he" ? "en" : "he";

  const isActive = (href: string, prefixes: readonly string[]) =>
    pathname === href || prefixes.some((p) => pathname.startsWith(p));

  if (theme === "forest") {
    // Brand, area name and the two main sections on the start side; help,
    // language, theme and the avatar on the end side.
    const [dashboard, history, help] = NAV;
    return (
      <header className="topbar tb">
        <div className="tb-start">
          <Link href="/student" className="tb-brand" aria-label={t("brand.name")}>
            <BrandMark size={56} />
          </Link>
          <span className="tb-divider" aria-hidden />
          <span className="tb-area">{t("brand.studentArea")}</span>
          <nav className="tb-nav" aria-label={t("nav.primary")}>
            {[
              { ...dashboard, Icon: GridIcon },
              history,
            ].map(({ href, key, Icon, prefixes }) => {
              const active = isActive(href, prefixes);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn("tb-link", active && "active")}
                  aria-current={active ? "page" : undefined}
                  title={t(key)}
                >
                  <Icon size={20} />
                  <span className="tb-label">{t(key)}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="tb-end">
          <Link
            href={help.href}
            className={cn("tb-link", isActive(help.href, help.prefixes) && "active")}
            aria-current={isActive(help.href, help.prefixes) ? "page" : undefined}
            title={t(help.key)}
          >
            <QuestionIcon size={20} />
            <span className="tb-label">{t(help.key)}</span>
          </Link>
          <span className="tb-divider" aria-hidden />
          <button
            type="button"
            className="tb-link tb-lang"
            aria-label={t("nav.language")}
            title={t("nav.language")}
            onClick={() => router.replace(pathname, { locale: otherLocale })}
          >
            {locale === "he" ? "EN" : "עב"}
          </button>
          <ThemeSwitcher className="tb-link tb-icon" showLabel={false} />
          <Link
            href="/student/profile"
            className={cn("tb-avatar", pathname === "/student/profile" && "active")}
            aria-label={t("nav.profile")}
            title={t("nav.profile")}
          >
            <span className="avatar" aria-hidden>
              {initial}
            </span>
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="topbar">
      <Link href="/student" className="topbar-brand" aria-label={t("brand.name")}>
        <BrandMark size={56} />
        <span className="topbar-tagline">{t("brand.tagline")}</span>
      </Link>
      <nav className="topbar-actions" aria-label={t("nav.primary")}>
        {NAV.map(({ href, key, Icon, prefixes }) => {
          const active = isActive(href, prefixes);
          return (
            <Link
              key={href}
              href={href}
              className={cn("nav-pill", active && "active")}
              aria-current={active ? "page" : undefined}
              aria-label={t(key)}
              title={t(key)}
            >
              <Icon size={14} />
              <span className="nav-pill-label">{t(key)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className="nav-pill"
          style={{ padding: "9px 14px" }}
          aria-label={t("nav.language")}
          title={t("nav.language")}
          onClick={() => router.replace(pathname, { locale: otherLocale })}
        >
          <GlobeIcon size={14} />
          {locale === "he" ? "EN" : "עב"}
        </button>
        <ThemeSwitcher className="nav-pill" showLabel={false} />
        <Link
          href="/student/profile"
          className={cn("avatar-link", pathname === "/student/profile" && "active")}
          aria-label={t("nav.profile")}
          title={t("nav.profile")}
        >
          <span className="avatar" aria-hidden>
            {initial}
          </span>
        </Link>
      </nav>
    </header>
  );
}
