import { setRequestLocale } from "next-intl/server";
import { LoginClient } from "./login-client";

interface LoginPageProps {
  params: Promise<{ locale: string }>;
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoginClient />;
}
