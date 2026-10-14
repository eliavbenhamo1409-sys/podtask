import type { ReactNode } from "react";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/lib/i18n/navigation";
import { LecturerShell } from "@/components/lecturer/lecturer-shell";
import { getLecturerProfile, isStaff } from "@/lib/lecturer/lecturer-service-server";
import { MOCK_MODE } from "@/lib/env";

interface LecturerLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Role gate for the whole lecturer area. The middleware already requires a
 * session; here the profile role is read from the database (the client can
 * never set it: see guard_profile_self_update) and every query below runs
 * under RLS anyway. A signed-in student sees a friendly "no access" page.
 */
export default async function LecturerLayout({ children, params }: LecturerLayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const profile = await getLecturerProfile();
  if (!profile && !MOCK_MODE) {
    redirect({ href: "/login?mode=lecturer", locale });
  }
  if (profile && !isStaff(profile)) {
    const t = await getTranslations();
    return (
      <LecturerShell initial={profile.avatarInitial}>
        <div className="page-narrow" style={{ paddingTop: 48 }}>
          <div className="card" style={{ padding: 36, textAlign: "center" }}>
            <h1 className="title" style={{ marginTop: 0 }}>
              {t("lecturer.noAccessTitle")}
            </h1>
            <p className="subtitle" style={{ maxWidth: 480, margin: "8px auto 0" }}>
              {t("lecturer.noAccessBody")}
            </p>
            <Link href="/student" className="btn btn-primary" style={{ marginTop: 24 }}>
              {t("lecturer.goToStudio")}
            </Link>
          </div>
        </div>
      </LecturerShell>
    );
  }
  return <>{children}</>;
}
