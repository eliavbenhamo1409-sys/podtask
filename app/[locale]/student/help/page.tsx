import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { QuestionIcon, SparkIcon } from "@/components/podtask/icons";

interface HelpPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("screens.help") };
}

export default async function HelpPage({ params }: HelpPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const faqs = [
    { titleKey: "help.q1Title", bodyKey: "help.q1Body" },
    { titleKey: "help.q2Title", bodyKey: "help.q2Body" },
    { titleKey: "help.q3Title", bodyKey: "help.q3Body" },
    { titleKey: "help.q4Title", bodyKey: "help.q4Body" },
  ];

  return (
    <StudentAppShell>
      <div className="page-narrow">
        <Eyebrow icon={<SparkIcon size={14} />}>{t("screens.help")}</Eyebrow>
        <h1 className="display">{t("help.title")}</h1>
        <p className="subtitle">{t("help.subtitle")}</p>

        <div className="flex-col" style={{ gap: 16, marginTop: 32 }}>
          {faqs.map((faq, i) => (
            <div key={faq.titleKey} className="card" style={{ padding: 28 }}>
              <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background:
                      i % 2 === 0
                        ? "rgba(125,211,252,0.18)"
                        : "rgba(253,164,175,0.22)",
                    color:
                      i % 2 === 0 ? "rgb(var(--cyan))" : "rgb(var(--pink-deep))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <QuestionIcon size={18} />
                </div>
                <div>
                  <h3
                    style={{
                      margin: "4px 0 8px",
                      fontSize: 17,
                      fontWeight: 800,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {t(faq.titleKey)}
                  </h3>
                  <p
                    className="text-muted"
                    style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}
                  >
                    {t(faq.bodyKey)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </StudentAppShell>
  );
}
