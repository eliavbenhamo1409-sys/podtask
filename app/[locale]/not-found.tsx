import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { Blobs } from "@/components/podtask/blobs";
import { BrandMark } from "@/components/podtask/brand-mark";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { ArrowIcon } from "@/components/podtask/icons";

export default async function NotFound() {
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
