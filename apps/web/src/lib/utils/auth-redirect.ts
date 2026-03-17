const AUTH_SESSION_INITIAL_WAIT_MS = 200;
const AUTH_SESSION_RETRY_WAIT_MS = 500;
const OAUTH_CONSENT_PATH = "/oauth/consent";
const AUTH_REDIRECT_EXCLUDED_QUERY_KEYS = new Set(["returnUrl", "email"]);

const OAUTH_CONSENT_QUERY_KEYS = [
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "response_type",
  "exp",
  "sig",
] as const;

interface WaitForAuthSessionOptions {
  context: "login" | "signup";
  getSession: () => Promise<unknown>;
  logWarning: (message: string) => void;
  initialDelayMs?: number;
  retryDelayMs?: number;
  waitForMs?: (ms: number) => Promise<void>;
}

interface AuthSessionResponse<TSession = unknown> {
  data?: {
    session?: TSession | null;
  } | null;
}

function waitForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAuthSessionGetter<TSession>(
  getSessionResponse: () => Promise<AuthSessionResponse<TSession> | null>,
): () => Promise<TSession | null> {
  return async () => {
    const sessionResponse = await getSessionResponse();
    return sessionResponse?.data?.session ?? null;
  };
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

export interface AuthRedirectSearchParams {
  [key: string]: string | string[] | undefined;
}

export async function getRedirectQueryString(
  searchParams: Promise<AuthRedirectSearchParams>,
): Promise<string> {
  const params = await searchParams;
  const preservedSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        preservedSearchParams.append(key, item);
      }
      continue;
    }

    if (value) {
      preservedSearchParams.set(key, value);
    }
  }

  return preservedSearchParams.toString();
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

export function normalizeAuthReturnUrl(returnUrl: string | undefined): string {
  const normalized = returnUrl?.trim() || "";
  const sanitizedReturnUrl =
    normalized && normalized !== "/" ? normalized : undefined;

  return getValidAuthRedirectUrl(sanitizedReturnUrl, "/");
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
  const filteredSearchParams = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (!AUTH_REDIRECT_EXCLUDED_QUERY_KEYS.has(key)) {
      filteredSearchParams.append(key, value);
    }
  }

  const hasSignedOAuthQuery =
    filteredSearchParams.has("client_id") &&
    filteredSearchParams.has("exp") &&
    filteredSearchParams.has("sig");

  if (hasSignedOAuthQuery) {
    return `${OAUTH_CONSENT_PATH}?${filteredSearchParams.toString()}`;
  }

  return buildOAuthConsentReturnUrl({
    client_id: filteredSearchParams.get("client_id") ?? undefined,
    redirect_uri: filteredSearchParams.get("redirect_uri") ?? undefined,
    code_challenge: filteredSearchParams.get("code_challenge") ?? undefined,
    code_challenge_method:
      filteredSearchParams.get("code_challenge_method") ?? undefined,
    scope: filteredSearchParams.get("scope") ?? undefined,
    state: filteredSearchParams.get("state") ?? undefined,
    response_type: filteredSearchParams.get("response_type") ?? undefined,
    exp: filteredSearchParams.get("exp") ?? undefined,
    sig: filteredSearchParams.get("sig") ?? undefined,
  });
}
