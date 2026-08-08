import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const signInUrl = new URL("/auth/v1/login", request.url);
    signInUrl.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
