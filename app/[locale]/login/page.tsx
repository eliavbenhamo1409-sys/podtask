import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { LoginClient } from "./login-client";

interface LoginPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("auth.signIn") };
}

export default async function LoginPage({ params, searchParams }: LoginPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { mode } = await searchParams;
  return <LoginClient initialMode={mode === "lecturer" ? "lecturer" : "student"} />;
}
