const DEFAULT_COOKIE_PREFIX = "sokosumi";
const PREPROD_COOKIE_PREFIX = "sokosumi-preprod";
const PREVIEW_COOKIE_PREFIX = "sokosumi-preview";
const LOCALHOST_COOKIE_PREFIX = "sokosumi-localhost";

type BetterAuthCookieNetwork = "Mainnet" | "Preprod";

export interface ResolveBetterAuthCookiePrefixParams {
  network?: BetterAuthCookieNetwork;
  vercelEnv?: string;
  vercelGitCommitRef?: string;
}

function sanitizeCookieSegment(value: string): string | undefined {
  let normalized = "";
  let previousWasSeparator = false;

  for (const character of value.toLowerCase()) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (isAlphaNumeric) {
      normalized += character;
      previousWasSeparator = false;
      continue;
    }

    if (normalized === "" || previousWasSeparator) {
      continue;
    }

    normalized += "-";
    previousWasSeparator = true;
  }

  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || undefined;
}

export function resolveBetterAuthCookiePrefix(
  params: ResolveBetterAuthCookiePrefixParams,
): string {
  const network = params.network ?? "Preprod";
  switch (params.vercelEnv) {
    case "production":
      return network === "Preprod"
        ? PREPROD_COOKIE_PREFIX
        : DEFAULT_COOKIE_PREFIX;
    case "preview":
      const previewKey = sanitizeCookieSegment(params.vercelGitCommitRef ?? "");

      if (previewKey) {
        return `${PREVIEW_COOKIE_PREFIX}-${network}-${previewKey}`;
      }

      return `${PREVIEW_COOKIE_PREFIX}-${network}`;
    case "development":
      return `${LOCALHOST_COOKIE_PREFIX}-${network}`;
    default:
      return `${LOCALHOST_COOKIE_PREFIX}-${network}`;
  }
}

export function getBetterAuthCookieName(
  cookiePrefix: string,
  cookieName: string,
): string {
  return `${cookiePrefix}.${cookieName}`;
}
