import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./lib/i18n/routing";
import { updateSession } from "./lib/supabase/middleware";

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const intlResponse = intlMiddleware(request);

  if (intlResponse instanceof NextResponse && intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  return updateSession(request, intlResponse);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|fonts|images|.*\\..*).*)",
  ],
};
