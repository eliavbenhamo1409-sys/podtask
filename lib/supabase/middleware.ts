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

  // getClaims() refreshes an expired session (via setAll above) exactly like
  // getUser() did, but verifies the access token LOCALLY against the
  // project's ES256 public key (JWKS, cached for 10 min per isolate) instead
  // of a round trip to Supabase Auth. Middleware runs at the edge closest to
  // the visitor, so the old getUser() call cost ~300 ms on every navigation.
  // This only gates the redirect to /login; data access is still enforced by
  // RLS and by the server-side calls in the pages.
  const { data: claimsData } = await supabase.auth.getClaims();
  const signedIn = Boolean(claimsData?.claims?.sub);

  const { pathname } = request.nextUrl;
  if (!MOCK_MODE && !signedIn && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    const localePrefix =
      locales.find((l) => pathname.startsWith(`/${l}/`)) ?? defaultLocale;
    url.pathname = `/${localePrefix}/login`;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
