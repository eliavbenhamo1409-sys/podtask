import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";

interface StudentLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function StudentLayout({
  children,
  params,
}: StudentLayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <>{children}</>;
}
