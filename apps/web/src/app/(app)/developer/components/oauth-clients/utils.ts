import { z } from "zod";

import type { TranslationFunction } from "./types";

export const DIALOG_CLEANUP_TIMEOUT = 300;

export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
  redirectUris: "",
};

export const DEFAULT_EDIT_FORM_VALUES = {
  name: "",
  redirectUris: "",
};

/** Schemes Better Auth's SafeUrlSchema rejects. */
const DANGEROUS_URL_SCHEMES = ["javascript:", "data:", "vbscript:"];

/**
 * Loopback hosts where HTTP is allowed (Better Auth SafeUrlSchema /
 * isLoopbackHost): IPv4 127.0.0.0/8, IPv6 ::1, localhost, *.localhost.
 */
function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.+$/, "");
  if (!normalized) {
    return false;
  }

  // Strip port for host:port forms (not bare IPv6 which has multiple colons).
  let hostname = normalized;
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    hostname = end === -1 ? hostname : hostname.slice(1, end);
  } else {
    const firstColon = hostname.indexOf(":");
    if (firstColon !== -1 && hostname.indexOf(":", firstColon + 1) === -1) {
      hostname = hostname.slice(0, firstColon);
    }
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }

  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // IPv4 127.0.0.0/8
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const c = Number(ipv4[3]);
    const d = Number(ipv4[4]);
    if ([a, b, c, d].every((n) => n >= 0 && n <= 255) && a === 127) {
      return true;
    }
  }

  return false;
}

/**
 * Aligns with Better Auth `SafeUrlSchema` (@better-auth/core/utils/redirect-uri):
 * parseable URL, no dangerous schemes, no fragment, HTTPS unless loopback HTTP,
 * custom app schemes allowed.
 */
export function isSafeRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }

  if (DANGEROUS_URL_SCHEMES.includes(url.protocol)) {
    return false;
  }

  // RFC 6749 §3.1.2 — no fragment component.
  if (uri.includes("#") || url.hash.length > 0) {
    return false;
  }

  if (url.protocol === "http:" && !isLoopbackHost(url.host)) {
    return false;
  }

  // https:, loopback http:, and custom schemes (e.g. myapp:) are allowed.
  return true;
}

function parseRedirectUris(value: string): string[] {
  return value
    .split("\n")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);
}

function areRedirectUrisValid(value: string): boolean {
  const uris = parseRedirectUris(value);
  if (uris.length === 0) {
    return false;
  }
  return uris.every((uri) => isSafeRedirectUri(uri));
}

export function createOAuthClientSchema(t: TranslationFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("Validation.nameRequired"))
      .max(100, t("Validation.nameMaxLength")),
    redirectUris: z
      .string()
      .min(1, t("Validation.redirectUrisRequired"))
      .refine(areRedirectUrisValid, {
        message: t("Validation.redirectUrisInvalid"),
      }),
  });
}

export function editOAuthClientSchema(t: TranslationFunction) {
  return createOAuthClientSchema(t);
}

export { parseRedirectUris };
