"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { BrandMark } from "@/components/podtask/brand-mark";
import { GlobeIcon, HomeIcon } from "@/components/podtask/icons";
import { createClient } from "@/lib/supabase/client";
import { clearCachedProfileInitial } from "@/lib/student/profile-initial";
import { MOCK_MODE } from "@/lib/env";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";

export function LecturerTopBar({ initial }: { initial?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale() as Locale;
  const otherLocale: Locale = locale === "he" ? "en" : "he";
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      if (!MOCK_MODE) await createClient().auth.signOut();
    } catch {
      /* the login screen clears any stale cookie */
    } finally {
      clearCachedProfileInitial();
      window.location.assign(`/${locale}/login?mode=lecturer`);
    }
  }

  const active = pathname === "/lecturer";

  return (
    <header className="topbar">
      <Link href="/lecturer" className="topbar-brand" aria-label={t("brand.name")}>
        <BrandMark size={56} />
        <span className="topbar-tagline">{t("lecturer.brand")}</span>
      </Link>
      <nav className="topbar-actions" aria-label={t("nav.primary")}>
        <Link
          href="/lecturer"
          className={cn("nav-pill", active && "active")}
          aria-current={active ? "page" : undefined}
        >
          <HomeIcon size={14} />
          <span className="nav-pill-label">{t("lecturer.navDashboard")}</span>
        </Link>
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
        <button
          type="button"
          className="nav-pill"
          onClick={() => void logout()}
          disabled={pending}
          title={t("nav.logout")}
        >
          <span className="nav-pill-label">{t("nav.logout")}</span>
        </button>
        {initial ? (
          <span className="avatar" aria-hidden>
            {initial}
          </span>
        ) : null}
      </nav>
    </header>
  );
}
