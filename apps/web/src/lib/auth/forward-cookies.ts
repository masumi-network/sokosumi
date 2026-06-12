import "server-only";

import { cookies, headers } from "next/headers";

const SECURE_COOKIE_PREFIX = "__Secure-";

function stripSecureCookiePrefix(cookieName: string): string {
  if (cookieName.startsWith(SECURE_COOKIE_PREFIX)) {
    return cookieName.slice(SECURE_COOKIE_PREFIX.length);
  }
  return cookieName;
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const chunk of cookieHeader.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = chunk.slice(0, eq).trim();
    const value = chunk.slice(eq + 1).trim();
    if (name && !parsed.has(name)) {
      parsed.set(name, value);
    }
  }
  return parsed;
}

function isBetterAuthStatefulCookie(logicalName: string): boolean {
  return (
    logicalName.endsWith(".session_token") ||
    logicalName.endsWith(".session_data") ||
    logicalName.endsWith(".dont_remember") ||
    logicalName.endsWith(".account_data") ||
    logicalName.includes(".session_data.") ||
    logicalName.includes(".account_data.")
  );
}

/**
 * After the web→core Better Auth migration, browsers may send both a stale
 * host-only session cookie and a domain-scoped __Secure- cookie with
 * different values. Better Auth prefers __Secure- when reading, but duplicate
 * same-name entries are last-wins in the Cookie header. Collapse auth cookies
 * to one physical name per logical key, preferring __Secure-.
 */
export function sanitizeForwardCookieHeader(cookieHeader: string): string {
  if (!cookieHeader) {
    return cookieHeader;
  }

  const parsed = parseCookieHeader(cookieHeader);
  const authLogicalNames = new Set<string>();
  const passthrough: Array<[string, string]> = [];

  for (const [name, value] of parsed) {
    const logical = stripSecureCookiePrefix(name);
    if (isBetterAuthStatefulCookie(logical)) {
      authLogicalNames.add(logical);
    } else {
      passthrough.push([name, value]);
    }
  }

  const serialized: string[] = [];

  for (const logical of authLogicalNames) {
    const secureName = `${SECURE_COOKIE_PREFIX}${logical}`;
    if (parsed.has(secureName)) {
      serialized.push(`${secureName}=${parsed.get(secureName)!}`);
      continue;
    }
    if (parsed.has(logical)) {
      serialized.push(`${logical}=${parsed.get(logical)!}`);
    }
  }

  for (const [name, value] of passthrough) {
    serialized.push(`${name}=${value}`);
  }

  return serialized.join("; ");
}

export async function buildAuthRequestHeadersForForwarding(): Promise<Headers> {
  const headerList = await headers();
  const cookieStore = await cookies();
  const merged = new Headers(headerList);

  const cookieFromStore = cookieStore
    .getAll()
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");
  const rawCookieHeader = cookieFromStore || headerList.get("cookie") || "";
  const sanitized = sanitizeForwardCookieHeader(rawCookieHeader);
  if (sanitized) {
    merged.set("cookie", sanitized);
  } else {
    merged.delete("cookie");
  }

  return merged;
}
