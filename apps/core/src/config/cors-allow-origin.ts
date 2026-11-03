import { getEnv } from "@/config/env";

/**
 * Loopback hosts used by local `pnpm *:dev` (`localhost`) and portless
 * (`web.sokosumi.localhost`, worktree-prefixed `main.web.sokosumi.localhost`).
 */
export function isLocalDevHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost");
}

/** Domains of first-party apps: Sokosumi and CMO.xyz, previews included. */
const FIRST_PARTY_DOMAINS = ["sokosumi.com", "cmo.xyz"];

/**
 * A page of a first-party app, over https; local dev hosts in development.
 * Where a provider may send a person back after connecting an account.
 */
export function isFirstPartyAppUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:") {
    return FIRST_PARTY_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  }
  return (
    getEnv().NODE_ENV === "development" &&
    url.protocol === "http:" &&
    isLocalDevHostname(host)
  );
}

/**
 * Echo value for `Access-Control-Allow-Origin` when the browser `Origin` is allowed,
 * or `null` to omit the header (disallowed).
 *
 * - Production/staging: `https:` origins whose host is `sokosumi.com` or `*.sokosumi.com`.
 * - Development (`NODE_ENV=development`): also allows `http:` / `https:` `localhost`
 *   and `*.localhost` (any port) for portless named URLs.
 */
export function resolveCorsAllowOrigin(requestOrigin: string): string | null {
  if (!requestOrigin) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(requestOrigin);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();

  if (host === "sokosumi.com" || host.endsWith(".sokosumi.com")) {
    if (url.protocol !== "https:") {
      return null;
    }
    return requestOrigin;
  }

  if (getEnv().NODE_ENV === "development" && isLocalDevHostname(host)) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return requestOrigin;
  }

  return null;
}
