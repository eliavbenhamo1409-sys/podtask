import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { SelfInitiatedUploadClient } from "./self-upload-client";

interface SelfNewPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("self.upload.eyebrow") };
}

export default async function SelfNewPage({ params }: SelfNewPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SelfInitiatedUploadClient />;
}
