import { redirect } from "@/lib/i18n/navigation";
import { setRequestLocale } from "next-intl/server";

interface RootPageProps {
  params: Promise<{ locale: string }>;
}

export default async function RootPage({ params }: RootPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/student", locale });
}
