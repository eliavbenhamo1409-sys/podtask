import { setRequestLocale } from "next-intl/server";
import { SelfInitiatedUploadClient } from "./self-upload-client";

interface SelfNewPageProps {
  params: Promise<{ locale: string }>;
}

export default async function SelfNewPage({ params }: SelfNewPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SelfInitiatedUploadClient />;
}
