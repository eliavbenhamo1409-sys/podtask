import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { defaultLocale, locales } from "../i18n/config";
import { MOCK_MODE } from "../env";

const PROTECTED_PATTERNS = [/^\/(he|en)\/student(\/|$)/];

function isProtectedPath(pathname: string) {
  return PROTECTED_PATTERNS.some((re) => re.test(pathname));
}

export async function updateSession(
  request: NextRequest,
  prevResponse: NextResponse,
) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return prevResponse;
  }

  let supabaseResponse = prevResponse;

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!MOCK_MODE && !user && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    const localePrefix =
      locales.find((l) => pathname.startsWith(`/${l}/`)) ?? defaultLocale;
    url.pathname = `/${localePrefix}/login`;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
