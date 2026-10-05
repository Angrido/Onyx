import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/locale";

const PUBLIC_PATHS = ["/login", "/setup"];

function withLocale(request: NextRequest, response: NextResponse): NextResponse {
  if (!request.cookies.has(LOCALE_COOKIE))
    response.cookies.set(LOCALE_COOKIE, DEFAULT_LOCALE, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const hasSession = request.cookies.has("onyx_sid");
  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return withLocale(request, NextResponse.redirect(url));
  }
  return withLocale(request, NextResponse.next());
}

export const config = {
  matcher: ["/((?!api|ws|_next/static|_next/image|favicon.ico|icon.svg|sw.js).*)"],
};
