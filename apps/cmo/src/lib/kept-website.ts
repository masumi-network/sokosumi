import { normalizeWebsiteUrl } from "@sokosumi/utils";

/**
 * The website a founder typed before signing in. It rides through the sign-in
 * round trip (a failed one too) and Home starts reading it on return; hiring
 * and Start over forget it.
 */
export const KEPT_WEBSITE_COOKIE = "cmo-website";

export const KEPT_WEBSITE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Sokosumi sends the founder back with a top-level GET, which lax allows.
  sameSite: "lax",
  path: "/",
  maxAge: 24 * 60 * 60,
} as const;

/** A kept website as the founder would type it, or undefined when there is none. */
export function keptWebsite(value: string | undefined): string | undefined {
  const url = normalizeWebsiteUrl(value ?? "");
  return url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined;
}

/** The `Set-Cookie` line that keeps a website, for a route's own response. */
export function keptWebsiteSetCookie(url: string): string {
  const { maxAge, path, secure } = KEPT_WEBSITE_OPTIONS;
  return [
    `${KEPT_WEBSITE_COOKIE}=${encodeURIComponent(url)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
