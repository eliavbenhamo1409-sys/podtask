import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { getStudentProfile } from "@/lib/student/student-service-server";
import { LogoutButton } from "@/components/student/logout-button";

interface ProfilePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("screens.profile") };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const profile = await getStudentProfile();

  const fields = [
    { label: t("profile.fullName"), value: profile.fullName },
    { label: t("profile.email"), value: profile.email },
    { label: t("profile.institution"), value: profile.institutionName },
    {
      label: t("profile.language"),
      value: profile.locale === "he" ? "עברית" : "English",
    },
  ];

  return (
    <StudentAppShell>
      <div className="page-narrow">
        <Eyebrow showDot>{t("screens.profile")}</Eyebrow>
        <h1 className="display">{t("profile.title")}</h1>
        <p className="subtitle">{t("profile.subtitle")}</p>

        <div className="card" style={{ padding: 32, marginTop: 32 }}>
          <div className="row" style={{ gap: 16, alignItems: "center" }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #FDA4AF, #7DD3FC)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontWeight: 800,
                fontSize: 28,
                boxShadow: "0 8px 22px rgba(14,165,233,0.2)",
              }}
            >
              {profile.avatarInitial}
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
                {profile.fullName}
              </div>
              <div className="text-muted" style={{ fontSize: 14 }}>
                <bdi>{profile.email}</bdi>
              </div>
            </div>
          </div>

          <div
            style={{
              height: 1,
              background: "rgb(var(--line))",
              margin: "24px 0",
            }}
          />

          <div className="flex-col" style={{ gap: 14 }}>
            {fields.map((f) => (
              <div key={f.label} className="between" style={{ gap: 16, flexWrap: "wrap" }}>
                <div
                  className="text-muted"
                  style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}
                >
                  {f.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  <bdi>{f.value}</bdi>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stack-actions" style={{ marginTop: 24 }}>
          <LogoutButton label={t("profile.logout")} />
        </div>
      </div>
    </StudentAppShell>
  );
}
