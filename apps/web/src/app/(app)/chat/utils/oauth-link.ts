import { getEnvPublicConfig } from "@/config/env.public";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION_PATTERN = /[),.;!?]+$/;
const OAUTH_START_PATH = "/oauth/sokosumi/start";
const OAUTH_AUTHORIZE_PATH_SEGMENT = "/oauth/authorize";

function normalizeCandidateUrl(candidate: string): string {
  return candidate.replace(TRAILING_PUNCTUATION_PATTERN, "");
}

let trustedOAuthDomains: Set<string> | null = null;

function getTrustedOAuthDomains(): Set<string> {
  if (trustedOAuthDomains) {
    return trustedOAuthDomains;
  }

  const env = getEnvPublicConfig();
  const domains = new Set<string>();

  const trustedBaseUrls = [
    env.NEXT_PUBLIC_HANNAH_URL,
    env.NEXT_PUBLIC_SOKOSUMI_URL,
    env.NEXT_PUBLIC_MCP_URL,
    env.NEXT_PUBLIC_KODOSUMI_URL,
    env.NEXT_PUBLIC_MASUMI_URL,
  ];

  for (const baseUrl of trustedBaseUrls) {
    try {
      domains.add(new URL(baseUrl).hostname.toLowerCase());
    } catch {
      continue;
    }
  }

  if (typeof window !== "undefined") {
    domains.add(window.location.hostname.toLowerCase());
  }

  trustedOAuthDomains = domains;
  return domains;
}

export function extractOAuthAuthorizationUrl(text: string): string | null {
  if (!text.trim()) {
    return null;
  }

  const candidates = text.match(URL_PATTERN);
  if (!candidates) {
    return null;
  }

  for (const rawCandidate of candidates) {
    const candidate = normalizeCandidateUrl(rawCandidate);

    try {
      const parsedUrl = new URL(candidate);
      const path = parsedUrl.pathname.toLowerCase();
      const hostname = parsedUrl.hostname.toLowerCase();

      const isOAuthStartLink = path === OAUTH_START_PATH;
      const isGenericAuthorizeLink = path.includes(
        OAUTH_AUTHORIZE_PATH_SEGMENT,
      );

      if (!getTrustedOAuthDomains().has(hostname)) {
        continue;
      }

      if (isOAuthStartLink || isGenericAuthorizeLink) {
        return parsedUrl.toString();
      }
    } catch {
      continue;
    }
  }

  return null;
}
