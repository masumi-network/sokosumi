const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION_PATTERN = /[),.;!?]+$/;
const OAUTH_START_PATH = "/oauth/sokosumi/start";
const OAUTH_AUTHORIZE_PATH_SEGMENT = "/oauth/authorize";

function normalizeCandidateUrl(candidate: string): string {
  return candidate.replace(TRAILING_PUNCTUATION_PATTERN, "");
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

      const isOAuthStartLink = path === OAUTH_START_PATH;
      const isGenericAuthorizeLink = path.includes(
        OAUTH_AUTHORIZE_PATH_SEGMENT,
      );

      if (isOAuthStartLink || isGenericAuthorizeLink) {
        return parsedUrl.toString();
      }
    } catch {
      continue;
    }
  }

  return null;
}
