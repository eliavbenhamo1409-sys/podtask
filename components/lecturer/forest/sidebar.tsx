"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { BrandMark } from "@/components/podtask/brand-mark";
import { ThemeSwitcher } from "@/components/podtask/theme-switcher";
import { GlobeIcon, HomeIcon, LogoutIcon } from "@/components/podtask/icons";
import { createClient } from "@/lib/supabase/client";
import { clearCachedProfileInitial } from "@/lib/student/profile-initial";
import { MOCK_MODE } from "@/lib/env";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";

interface ForestSidebarProps {
  name: string;
  role: string;
  initials: string;
}

/**
 * Forest lecturer navigation: wordmark, area name, the sections that exist
 * today, and the account tools at the bottom. On phones the same element
 * becomes a slim bar at the top (CSS only).
 */
export function ForestSidebar({ name, role, initials }: ForestSidebarProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale() as Locale;
  const otherLocale: Locale = locale === "he" ? "en" : "he";
  const [pending, setPending] = useState(false);

  // Same sign-out as the classic lecturer top bar.
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

  const onOverview = pathname === "/lecturer";
  // Course, assignment and report pages are reached from the overview.
  const inOverview = pathname === "/lecturer" || pathname.startsWith("/lecturer/");

  return (
    <aside className="lxf-side">
      <div className="lxf-side-top">
        <Link href="/lecturer" className="lxf-brand" aria-label={t("brand.name")}>
          <BrandMark size={60} />
        </Link>
        <div className="lxf-area">{t("brand.lecturerArea")}</div>
      </div>

      <nav className="lxf-nav" aria-label={t("nav.primary")}>
        <Link
          href="/lecturer"
          className={cn("lxf-nav-item", inOverview && "active")}
          aria-current={onOverview ? "page" : undefined}
          title={t("forestLecturer.navOverview")}
        >
          <HomeIcon size={22} strokeWidth={1.6} aria-hidden />
          <span className="lxf-nav-label">{t("forestLecturer.navOverview")}</span>
        </Link>
      </nav>

      <div className="lxf-side-foot">
        <div className="lxf-tools">
          <button
            type="button"
            className="lxf-tool"
            aria-label={t("nav.language")}
            title={t("nav.language")}
            onClick={() => router.replace(pathname, { locale: otherLocale })}
          >
            <GlobeIcon size={19} strokeWidth={1.6} aria-hidden />
            <span className="lxf-tool-label">{locale === "he" ? "English" : "עברית"}</span>
          </button>
          <ThemeSwitcher className="lxf-tool" placement="up" />
          <button
            type="button"
            className="lxf-tool"
            onClick={() => void logout()}
            disabled={pending}
            aria-label={t("nav.logout")}
            title={t("nav.logout")}
          >
            <LogoutIcon size={19} strokeWidth={1.6} aria-hidden />
            <span className="lxf-tool-label">{t("nav.logout")}</span>
          </button>
        </div>
        <div className="lxf-user">
          <span className="avatar" aria-hidden>
            {initials}
          </span>
          <span className="lxf-user-text">
            <span className="lxf-user-name">{name}</span>
            <span className="lxf-user-role">{role}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
