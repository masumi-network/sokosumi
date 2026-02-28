const AUTH_SESSION_INITIAL_WAIT_MS = 200;
const AUTH_SESSION_RETRY_WAIT_MS = 500;
const OAUTH_CONSENT_PATH = "/oauth/consent";

const OAUTH_CONSENT_QUERY_KEYS = [
  "client_id",
  "redirect_uri",
  "code_challenge",
  "scope",
  "state",
  "response_type",
] as const;

interface WaitForAuthSessionOptions {
  context: "login" | "signup";
  getSession: () => Promise<unknown>;
  logWarning: (message: string) => void;
  initialDelayMs?: number;
  retryDelayMs?: number;
  waitForMs?: (ms: number) => Promise<void>;
}

function waitForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForAuthSession({
  context,
  getSession,
  logWarning,
  initialDelayMs = AUTH_SESSION_INITIAL_WAIT_MS,
  retryDelayMs = AUTH_SESSION_RETRY_WAIT_MS,
  waitForMs: waitForMsFn = waitForMs,
}: WaitForAuthSessionOptions): Promise<void> {
  await waitForMsFn(initialDelayMs);

  const session = await getSession();
  if (session) {
    return;
  }

  logWarning(
    `Session not established after ${context}, waiting for ${retryDelayMs}ms`,
  );
  await waitForMsFn(retryDelayMs);

  const retrySession = await getSession();
  if (!retrySession) {
    logWarning(
      `Session not established after ${context}, proceeding with redirect anyway`,
    );
  }
}

interface BuildSignUpUrlParams {
  returnUrl?: string;
  email?: string;
}

export function buildSignUpUrlFromSignIn({
  returnUrl,
  email,
}: BuildSignUpUrlParams): string {
  const searchParams = new URLSearchParams();

  if (returnUrl) {
    searchParams.set("returnUrl", returnUrl);
  }
  if (email) {
    searchParams.set("email", email);
  }

  const query = searchParams.toString();
  return query ? `/signup?${query}` : "/signup";
}

export function getValidAuthRedirectUrl(
  returnUrl: string | undefined,
  fallback: string = "/",
): string {
  if (!returnUrl) {
    return fallback;
  }

  try {
    const parsedUrl = new URL(returnUrl, window.location.origin);
    return parsedUrl.origin === window.location.origin ? returnUrl : fallback;
  } catch {
    return fallback;
  }
}

type OAuthConsentParamRecord = Partial<
  Record<(typeof OAUTH_CONSENT_QUERY_KEYS)[number], string | undefined>
>;

export function buildOAuthConsentReturnUrl(
  params: OAuthConsentParamRecord,
): string | undefined {
  if (!params.client_id || !params.redirect_uri || !params.code_challenge) {
    return undefined;
  }

  const searchParams = new URLSearchParams();

  for (const key of OAUTH_CONSENT_QUERY_KEYS) {
    const value = params[key];
    if (value) {
      searchParams.set(key, value);
    }
  }

  return `${OAUTH_CONSENT_PATH}?${searchParams.toString()}`;
}

export function buildOAuthConsentReturnUrlFromSearchParams(
  searchParams: URLSearchParams,
): string | undefined {
  return buildOAuthConsentReturnUrl({
    client_id: searchParams.get("client_id") ?? undefined,
    redirect_uri: searchParams.get("redirect_uri") ?? undefined,
    code_challenge: searchParams.get("code_challenge") ?? undefined,
    scope: searchParams.get("scope") ?? undefined,
    state: searchParams.get("state") ?? undefined,
    response_type: searchParams.get("response_type") ?? undefined,
  });
}
