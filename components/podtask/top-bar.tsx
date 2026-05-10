"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/lib/i18n/navigation";
import { useLocale } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { BrandMark } from "./brand-mark";
import { BellIcon, GlobeIcon, SearchIcon } from "./icons";
import type { Locale } from "@/lib/i18n/config";

interface TopBarProps {
  studentInitial?: string;
}

export function TopBar({ studentInitial = "?" }: TopBarProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale() as Locale;

  const otherLocale: Locale = locale === "he" ? "en" : "he";

  return (
    <header className="topbar">
      <Link
        href="/student"
        className="row"
        style={{
          gap: 14,
          cursor: "pointer",
          textDecoration: "none",
          color: "inherit",
          alignItems: "center",
        }}
        aria-label={t("brand.name")}
      >
        <BrandMark size={56} />
        <div
          style={{
            fontSize: 11,
            color: "rgb(var(--muted))",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {t("brand.tagline")}
        </div>
      </Link>
      <div className="row" style={{ gap: 14 }}>
        <button
          type="button"
          className="nav-pill row"
          style={{ display: "inline-flex", gap: 8 }}
          aria-label={t("nav.search")}
        >
          <SearchIcon size={14} />
          {t("nav.search")}
          <span
            style={{
              color: "rgb(var(--muted))",
              fontWeight: 500,
              marginInlineStart: 6,
              fontSize: 11,
            }}
          >
            {t("nav.shortcut")}
          </span>
        </button>
        <button
          type="button"
          className="nav-pill row"
          style={{ display: "inline-flex", gap: 6, padding: "9px 14px" }}
          aria-label={t("nav.language")}
          onClick={() => router.replace(pathname, { locale: otherLocale })}
        >
          <GlobeIcon size={14} />
          {locale === "he" ? "EN" : "עב"}
        </button>
        <button
          type="button"
          className="nav-pill"
          style={{ padding: "9px 12px" }}
          aria-label={t("nav.notifications")}
        >
          <BellIcon size={16} />
        </button>
        <div className="avatar" aria-hidden>
          {studentInitial}
        </div>
      </div>
    </header>
  );
}
