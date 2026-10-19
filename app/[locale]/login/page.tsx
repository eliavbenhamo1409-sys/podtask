import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { LoginClient } from "./login-client";

interface LoginPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string; next?: string }>;
}

// The middleware sends signed-out visitors here with `next` = the path they
// asked for. Only an in-app student / lecturer path is ever followed.
const NEXT_PATTERN = /^\/(he|en)\/(student|lecturer)(\/[A-Za-z0-9_-]+)*\/?$/;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("auth.signIn") };
}

export default async function LoginPage({ params, searchParams }: LoginPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { mode, next } = await searchParams;
  const match = typeof next === "string" ? NEXT_PATTERN.exec(next) : null;
  const nextArea = match?.[2];
  const initialMode = mode === "lecturer" || nextArea === "lecturer" ? "lecturer" : "student";
  return <LoginClient initialMode={initialMode} next={match ? next : undefined} />;
}
