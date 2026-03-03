import { NextResponse } from "next/server";

const CANONICAL_PATH = "/.well-known/oauth-authorization-server/api/auth";

export async function GET(request: Request) {
  const canonicalUrl = new URL(CANONICAL_PATH, request.url);
  return NextResponse.redirect(canonicalUrl, 308);
}
