import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { Blobs } from "@/components/podtask/blobs";
import { BrandMark } from "@/components/podtask/brand-mark";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { ArrowIcon, FileTextIcon } from "@/components/podtask/icons";
import { getTheme } from "@/lib/theme/server";

export default async function NotFound() {
  if ((await getTheme()) === "forest") return <ForestNotFound />;
  const t = await getTranslations();
  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          className="card-hero card-pad-lg"
          style={{ width: "100%", maxWidth: 520, padding: 48, textAlign: "center" }}
        >
          <BrandMark size={72} />
          <div style={{ marginTop: 20 }}>
            <Eyebrow showDot>404</Eyebrow>
          </div>
          <h1 className="title" style={{ marginTop: 12 }}>
            {t("notFound.title")}
          </h1>
          <p className="subtitle">{t("notFound.body")}</p>
          <Link href="/student" className="btn btn-primary btn-lg" style={{ marginTop: 28 }}>
            {t("notFound.cta")}
            <span className="icon-flip">
              <ArrowIcon />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Forest theme: wordmark above a plain hairline card (same frame as the
 *  forest login), same destination as the classic page plus a quiet way to
 *  the help page. Styles: styles/themes/forest/auth.css. */
async function ForestNotFound() {
  const t = await getTranslations("forestAuth.notFound");
  return (
    <div className="screen fa-shell">
      <main className="fa-shell-inner">
        <div className="fa-brand">
          <BrandMark size={64} />
        </div>
        <section className="card fa-card fa-nf" aria-labelledby="fa-nf-title">
          <span className="fa-nf-icon" aria-hidden>
            <FileTextIcon size={26} />
          </span>
          <p className="fa-nf-code">{t("code")}</p>
          <h1 id="fa-nf-title" className="fa-title">
            {t("title")}
          </h1>
          <p className="fa-sub">{t("body")}</p>
          <div className="fa-nf-actions">
            <Link href="/student" className="btn btn-primary btn-lg fa-nf-cta">
              {t("cta")}
              <span className="icon-flip">
                <ArrowIcon />
              </span>
            </Link>
            <Link href="/student/help" className="fa-link">
              {t("help")}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
