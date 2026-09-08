import { z } from "zod";

import type { TranslationFunction } from "./types";

export const DIALOG_CLEANUP_TIMEOUT = 300;

export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
  redirectUris: "",
  includeCoreApi: false,
  includeOfflineAccess: false,
  isPublic: false,
};

export const DEFAULT_EDIT_FORM_VALUES = {
  name: "",
  redirectUris: "",
  includeCoreApi: false,
  includeOfflineAccess: false,
};

export type OAuthApplicationType = "web" | "native";

/** Schemes Better Auth rejects for any redirect URI. */
const DANGEROUS_URL_SCHEMES = ["javascript:", "data:", "vbscript:"];

const FORBIDDEN_NATIVE_REDIRECT_SCHEMES = new Set([
  "file:",
  "ftp:",
  "mailto:",
  "javascript:",
  "data:",
  "vbscript:",
]);

const REVERSE_DOMAIN_PRIVATE_USE_SCHEME =
  /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function isLoopbackIpHostname(hostname: string): boolean {
  let normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (!ipv4) {
    return false;
  }

  const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map(Number);
  return octets.every((n) => n >= 0 && n <= 255) && octets[0] === 127;
}

function isWebRedirectLoopback(hostname: string): boolean {
  return hostname === "localhost" || isLoopbackIpHostname(hostname);
}

function getRawHttpHostname(redirectUri: string): string | null {
  const authority = /^http:\/\/([^/?#]*)/i.exec(redirectUri)?.[1];
  if (!authority) {
    return null;
  }
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostAndPort.startsWith("[")) {
    const bracketEnd = hostAndPort.indexOf("]");
    return bracketEnd < 0
      ? null
      : hostAndPort.slice(0, bracketEnd + 1).toLowerCase();
  }
  return (hostAndPort.split(":")[0] ?? "").toLowerCase();
}

function isAllowedNativeHttpLoopback(redirectUri: string): boolean {
  const rawHttpHostname = getRawHttpHostname(redirectUri);
  return (
    rawHttpHostname === "localhost" ||
    rawHttpHostname === "127.0.0.1" ||
    rawHttpHostname === "[::1]"
  );
}

/**
 * RFC 8252 §7.1 private-use redirect: reverse-domain scheme, no authority
 * (`com.example.app:/callback`, not `myapp://callback`).
 */
function isReverseDomainPrivateUseRedirectUri(uri: URL): boolean {
  const schemeSpecificPart = uri.href.slice(uri.protocol.length);
  return (
    uri.protocol !== "http:" &&
    uri.protocol !== "https:" &&
    uri.host.length === 0 &&
    schemeSpecificPart.startsWith("/") &&
    !schemeSpecificPart.startsWith("//") &&
    REVERSE_DOMAIN_PRIVATE_USE_SCHEME.test(uri.protocol.slice(0, -1))
  );
}

/**
 * Web clients are HTTPS-only. Anything else (loopback HTTP or a private-use
 * scheme) must register as native — Better Auth defaults omitted type to web.
 */
export function inferOAuthApplicationType(
  uris: string[],
): OAuthApplicationType {
  for (const uri of uris) {
    try {
      if (new URL(uri).protocol !== "https:") {
        return "native";
      }
    } catch {
      return "native";
    }
  }
  return "web";
}

/**
 * Mirrors Better Auth `validateClientRedirectUri` (oauth-provider register.ts).
 * SafeUrlSchema is only the first gate; create-client then applies web vs native.
 */
export function isSafeRedirectUri(
  uri: string,
  applicationType: OAuthApplicationType = inferOAuthApplicationType([uri]),
): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }

  if (DANGEROUS_URL_SCHEMES.includes(url.protocol)) {
    return false;
  }

  if (
    uri.includes("#") ||
    url.hash.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return false;
  }

  if (/^localhost\.+$/i.test(url.hostname)) {
    return false;
  }

  const isHttp = url.protocol === "http:";
  const isHttps = url.protocol === "https:";
  const isRedirectLoopback = isWebRedirectLoopback(url.hostname);

  if (applicationType === "web") {
    return isHttps && !isRedirectLoopback;
  }

  if (isHttps) {
    return !isRedirectLoopback;
  }
  if (isHttp) {
    return isAllowedNativeHttpLoopback(uri);
  }

  return (
    !FORBIDDEN_NATIVE_REDIRECT_SCHEMES.has(url.protocol) &&
    isReverseDomainPrivateUseRedirectUri(url)
  );
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
  const applicationType = inferOAuthApplicationType(uris);
  return uris.every((uri) => isSafeRedirectUri(uri, applicationType));
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
    includeCoreApi: z.boolean(),
    includeOfflineAccess: z.boolean(),
    isPublic: z.boolean(),
  });
}

/**
 * True for public PKCE clients (no secret). Better Auth 1.7 derives this from
 * `token_endpoint_auth_method === "none"`; the legacy `public` flag is kept
 * as a fallback for rows shaped by older clients.
 */
export function isPublicOAuthClient(
  client:
    | {
        token_endpoint_auth_method?: string | null;
        public?: boolean | null;
      }
    | null
    | undefined,
): boolean {
  if (!client) {
    return false;
  }
  if (client.token_endpoint_auth_method === "none") {
    return true;
  }
  return client.public === true;
}

export function editOAuthClientSchema(t: TranslationFunction) {
  // Client auth method cannot change after creation, so edit keeps the
  // create shape minus the immutable client-type flag.
  return createOAuthClientSchema(t).omit({ isPublic: true });
}

export { parseRedirectUris };
