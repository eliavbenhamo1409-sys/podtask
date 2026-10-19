import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Eyebrow } from "@/components/podtask/eyebrow";
import {
  ArrowIcon,
  BarChartIcon,
  CameraIcon,
  FileTextIcon,
  FileUpIcon,
  MessageIcon,
  QuestionIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import { Link } from "@/lib/i18n/navigation";
import { getTheme } from "@/lib/theme/server";

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

  if ((await getTheme()) === "forest") {
    const questions = [
      { id: "q1", Icon: MessageIcon },
      { id: "q2", Icon: CameraIcon },
      { id: "q3", Icon: FileTextIcon },
      { id: "q4", Icon: BarChartIcon },
      { id: "q5", Icon: FileUpIcon },
    ];
    const stages = [
      { label: "journey.upload", body: "forestHome.help.howUpload" },
      { label: "journey.prepare", body: "forestHome.help.howPrepare" },
      { label: "journey.talk", body: "forestHome.help.howTalk" },
      { label: "journey.feedback", body: "forestHome.help.howFeedback" },
    ];

    return (
      <StudentAppShell>
        <div className="page fh-help">
          <header className="fh-head">
            <h1 className="display">{t("forestHome.help.title")}</h1>
            <p className="subtitle">{t("forestHome.help.subtitle")}</p>
          </header>

          <div className="fh-help-grid">
            <section className="card fh-card" aria-labelledby="fh-help-faq">
              <h2 id="fh-help-faq" className="fh-card-title">
                {t("forestHome.help.faqTitle")}
              </h2>
              <ul className="fh-list">
                {questions.map(({ id, Icon }) => (
                  <li key={id} className="fh-list-row">
                    <span className="fh-list-icon" aria-hidden>
                      <Icon size={22} />
                    </span>
                    <div>
                      <h3 className="fh-list-title">{t(`forestHome.help.${id}Title`)}</h3>
                      <p className="fh-list-body">{t(`forestHome.help.${id}Body`)}</p>
                      {id === "q5" ? (
                        <Link href="/student/self/new" className="fh-link fh-list-link">
                          {t("forestHome.help.q5Cta")}
                          <span className="icon-flip fh-arrow" aria-hidden>
                            <ArrowIcon size={18} />
                          </span>
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card fh-card fh-how" aria-labelledby="fh-help-how">
              <h2 id="fh-help-how" className="fh-card-title">
                {t("forestHome.help.howTitle")}
              </h2>
              <ol className="fh-how-list">
                {stages.map((s, i) => (
                  <li key={s.label} className="fh-how-row">
                    <span className="fh-how-num" aria-hidden>
                      {i + 1}
                    </span>
                    <div>
                      <div className="fh-list-title">{t(s.label)}</div>
                      <p className="fh-list-body">{t(s.body)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      </StudentAppShell>
    );
  }

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
