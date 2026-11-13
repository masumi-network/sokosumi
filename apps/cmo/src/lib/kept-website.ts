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

/** Prefixes the hidden fields that carry a Create account link's parameters. */
export const SIGN_UP_CONTEXT_FIELD = "signup.";
