import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { getLecturerProfile } from "@/lib/lecturer/lecturer-service-server";
import { ForestSidebar } from "./sidebar";
import { ForestHelpButton } from "./help-button";
import { initialsOf, roleKey, type Crumb } from "./util";

interface ForestLecturerShellProps {
  children: ReactNode;
  crumbs?: Crumb[];
}

/**
 * Forest frame of every lecturer screen: a sidebar on the start side, a slim
 * top bar with breadcrumbs and help, and the page. The profile read is the
 * same cached call the layout already made.
 */
export async function ForestLecturerShell({ children, crumbs }: ForestLecturerShellProps) {
  const t = await getTranslations();
  const profile = await getLecturerProfile();
  const name = profile?.fullName ?? "";
  const trail: Crumb[] = crumbs?.length
    ? crumbs
    : [{ label: t("brand.lecturerArea") }, { label: t("forestLecturer.navOverview") }];

  return (
    <div className="lxf">
      <ForestSidebar
        name={name}
        role={profile ? t(roleKey(profile.role)) : ""}
        initials={profile ? initialsOf(name) : ""}
      />
      <div className="lxf-body">
        <header className="lxf-top">
          <nav className="lxf-crumbs" aria-label={t("forestLecturer.crumbsLabel")}>
            <ol>
              {trail.map((c, i) => {
                const last = i === trail.length - 1;
                return (
                  <li key={`${i}-${c.label}`}>
                    {c.href && !last ? (
                      <Link href={c.href}>{c.label}</Link>
                    ) : (
                      <span aria-current={last ? "page" : undefined}>{c.label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <ForestHelpButton />
        </header>
        <main className="lxf-main">{children}</main>
      </div>
    </div>
  );
}
