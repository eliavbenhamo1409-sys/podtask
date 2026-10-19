import "../../styles/globals.css";
import "../../styles/themes/switcher.css";
import "../../styles/themes/forest/base.css";
import "../../styles/themes/forest/student-home.css";
import "../../styles/themes/forest/journey.css";
import "../../styles/themes/forest/prep.css";
import "../../styles/themes/forest/room.css";
import "../../styles/themes/forest/report.css";
import "../../styles/themes/forest/lecturer.css";
import "../../styles/themes/forest/auth.css";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale, getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { Heebo, Manrope } from "next/font/google";
import { routing } from "@/lib/i18n/routing";
import { localeMeta, type Locale } from "@/lib/i18n/config";
import { MotionProvider } from "@/components/providers/motion-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { getTheme } from "@/lib/theme/server";
import { THEME_COLOR } from "@/lib/theme/config";
import type { Metadata, Viewport } from "next";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-heebo",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Podtask", template: "%s · Podtask" },
  description: "AI-led podcast-style academic interview studio.",
  // Small raster icons (2-6 KB) instead of the 69 KB logo on every first visit.
  icons: { icon: "/icon-64.png", apple: "/icon-180.png" },
};

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: THEME_COLOR[await getTheme()] };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = localeMeta[locale as Locale].dir;
  const theme = await getTheme();

  return (
    <html
      lang={locale}
      dir={dir}
      data-theme={theme}
      className={`${heebo.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* The browser talks to Supabase directly (uploads, realtime session,
            transcript). Opening the TLS connection early saves ~100-150 ms
            on the first of those calls. */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL ? (
          <>
            <link
              rel="preconnect"
              href={process.env.NEXT_PUBLIC_SUPABASE_URL}
              crossOrigin="anonymous"
            />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
          </>
        ) : null}
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider initial={theme}>
            <MotionProvider>{children}</MotionProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
