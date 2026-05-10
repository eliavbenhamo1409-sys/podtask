import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Badge, Chip } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { Waveform } from "@/components/podtask/waveform";
import {
  MicIcon,
  QuestionIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import { getSubmissionLobby } from "@/lib/student/student-service-server";

interface LobbyPageProps {
  params: Promise<{ locale: string; submissionId: string }>;
}

export default async function LobbyPage({ params }: LobbyPageProps) {
  const { locale, submissionId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const lobby = await getSubmissionLobby(submissionId);
  if (!lobby) notFound();

  const tips = [
    { titleKey: "lobby.tip1Title", bodyKey: "lobby.tip1Body" },
    { titleKey: "lobby.tip2Title", bodyKey: "lobby.tip2Body" },
    { titleKey: "lobby.tip3Title", bodyKey: "lobby.tip3Body" },
  ];

  const topics = [
    t("lobby.topic1"),
    t("lobby.topic2"),
    t("lobby.topic3"),
    t("lobby.topic4"),
  ];

  return (
    <StudentAppShell blobsVariant="studio">
      <div className="page">
        <div className="row" style={{ gap: 12 }}>
          <Badge variant="cyan" showDot>
            {t("status.studioReady")}
          </Badge>
        </div>
        <h1 className="display" style={{ fontSize: 42, marginTop: 16 }}>
          {t("lobby.title")}
        </h1>
        <p className="subtitle" style={{ maxWidth: 580 }}>
          {t("lobby.subtitle")}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 1fr",
            gap: 32,
            marginTop: 40,
            alignItems: "start",
          }}
        >
          <div
            className="card-hero"
            style={{ padding: 36, position: "relative", overflow: "hidden" }}
          >
            <div className="between">
              <Eyebrow icon={<MicIcon size={14} />}>
                {t("lobby.podcastInterview")}
              </Eyebrow>
              <Chip variant="cyan">{t("lobby.estTime")}</Chip>
            </div>

            <div
              className="row"
              style={{ gap: 24, marginTop: 32, alignItems: "center" }}
            >
              <div style={{ position: "relative" }}>
                <GlowOrb size={120} />
                <div
                  style={{
                    position: "absolute",
                    bottom: -4,
                    insetInlineStart: -4,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 12px rgba(14,165,233,0.3)",
                    color: "rgb(var(--cyan))",
                  }}
                >
                  <SparkIcon size={16} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "rgb(var(--cyan))",
                    letterSpacing: "0.18em",
                  }}
                >
                  {t("lobby.yourHost")}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    marginTop: 4,
                  }}
                >
                  {t("lobby.hostName")}
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: 14, marginTop: 2 }}
                >
                  {t("lobby.hostBio")}
                </div>
                <div style={{ marginTop: 16 }}>
                  <Waveform />
                </div>
              </div>
            </div>

            <div
              style={{
                height: 1,
                background: "rgba(230,238,247,0.7)",
                margin: "28px 0",
              }}
            />

            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "rgb(var(--ink-2))",
              }}
            >
              {t("lobby.weWillTalk")}
            </div>
            <div
              className="row"
              style={{ gap: 8, marginTop: 16, flexWrap: "wrap" }}
            >
              {topics.map((topic) => (
                <Chip key={topic} variant="cyan">
                  {topic}
                </Chip>
              ))}
            </div>

            <div style={{ marginTop: 32 }}>
              <Link
                href={`/student/submissions/${submissionId}/mic-test`}
                style={{ textDecoration: "none" }}
              >
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  style={{ width: "100%" }}
                >
                  <MicIcon size={18} /> {t("lobby.testMicAndStart")}
                </button>
              </Link>
              <div
                className="text-muted"
                style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}
              >
                {t("lobby.stopAnytime")}
              </div>
            </div>
          </div>

          <div>
            <div className="card" style={{ padding: 32 }}>
              <Eyebrow icon={<SparkIcon size={14} />}>
                {t("lobby.beforeYouStart")}
              </Eyebrow>
              <div className="flex-col" style={{ gap: 16, marginTop: 16 }}>
                {tips.map((tip, i) => (
                  <div
                    key={tip.titleKey}
                    className="row"
                    style={{ gap: 16, alignItems: "flex-start" }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        background:
                          i === 0
                            ? "rgba(125,211,252,0.18)"
                            : i === 1
                              ? "rgba(253,164,175,0.22)"
                              : "rgba(186,230,253,0.4)",
                        color:
                          i === 1
                            ? "rgb(var(--pink-deep))"
                            : "rgb(var(--cyan))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>
                        {t(tip.titleKey)}
                      </div>
                      <div
                        className="text-muted"
                        style={{ fontSize: 13, lineHeight: 1.5, marginTop: 2 }}
                      >
                        {t(tip.bodyKey)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="card"
              style={{
                marginTop: 24,
                padding: 24,
                background: "rgba(255,241,245,0.6)",
                boxShadow: "none",
                borderRadius: 24,
              }}
            >
              <div className="row" style={{ gap: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background: "rgba(253,164,175,0.3)",
                    color: "rgb(var(--pink-deep))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <QuestionIcon size={18} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {t("lobby.stuckTitle")}
                  </div>
                  <div
                    className="text-muted"
                    style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}
                  >
                    {t("lobby.stuckBody")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StudentAppShell>
  );
}
