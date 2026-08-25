import type { AuthMethodId } from "@/lib/schemas";

const AUTH_SESSION_INITIAL_WAIT_MS = 200;
const AUTH_SESSION_RETRY_WAIT_MS = 500;
const OAUTH_CONSENT_PATH = "/oauth/consent";
const AUTH_REDIRECT_EXCLUDED_QUERY_KEYS = new Set(["returnUrl", "email"]);
const SIGNED_OAUTH_QUERY_PARAMETER_NAMES_KEY = "ba_param";

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

// Resolution base used to validate redirect paths when `window` is unavailable
// (SSR). The `.invalid` TLD is reserved and never resolvable, so any input that
// resolves to a different origin (absolute or protocol-relative URL) is rejected
// while genuine same-origin relative paths are preserved.
const SSR_REDIRECT_ORIGIN = "https://localhost.invalid";

function sanitizeAuthRedirectPath(
  returnUrl: string | undefined,
  fallback: string = "/",
): string {
  if (!returnUrl) {
    return fallback;
  }

  // Validate against the real origin on the client and a reserved placeholder
  // origin during SSR. Either way, only same-origin relative paths survive —
  // absolute (`https://evil`) and protocol-relative (`//evil`) URLs resolve to
  // a different origin and fall back, closing the open-redirect vector in both
  // contexts.
  const baseOrigin =
    typeof window !== "undefined"
      ? window.location.origin
      : SSR_REDIRECT_ORIGIN;

  try {
    const parsedUrl = new URL(returnUrl, baseOrigin);
    return parsedUrl.origin === baseOrigin ? returnUrl : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Absolute callback/redirect URL for `authClient` when Better Auth runs on Core.
 *
 * Relative paths resolve against the auth-server origin (e.g. `api.preprod…`),
 * so `/chat` becomes `https://api.preprod…/chat` instead of the web app.
 * Falls back to a relative path when `window` is unavailable (SSR).
 */
export function sanitizeAuthRedirectPathForOrigin(
  returnUrl: string | undefined,
  origin: string,
  fallback: string = "/",
): string {
  if (!returnUrl) {
    return fallback;
  }

  try {
    const parsedUrl = new URL(returnUrl, origin);
    return parsedUrl.origin === origin ? returnUrl : fallback;
  } catch {
    return fallback;
  }
}

export function getAbsoluteRedirectUrlForOrigin(
  origin: string,
  returnUrl: string | undefined,
  fallback: string = "/",
): string {
  const safePath = sanitizeAuthRedirectPathForOrigin(
    returnUrl,
    origin,
    fallback,
  );
  return new URL(safePath, origin).href;
}

export function getAbsoluteAuthRedirectUrl(
  returnUrl: string | undefined,
  fallback: string = "/",
): string {
  if (typeof window === "undefined") {
    return sanitizeAuthRedirectPath(returnUrl, fallback);
  }

  return getAbsoluteRedirectUrlForOrigin(
    window.location.origin,
    returnUrl,
    fallback,
  );
}

/**
 * Builds a social-auth callback URL for `authClient.signIn.social`.
 *
 * The result is an **absolute** URL anchored to the current web origin. This
 * matters when the browser `authClient` targets the Core Better Auth instance
 * (a different origin, e.g. `api.preprod.sokosumi.com`): Better Auth resolves a
 * relative `callbackURL` against the auth-server origin, so a bare
 * `/auth/callback/signin` would both land on the Core domain and collide with
 * Core's own `/auth/callback/:provider` route — surfacing as `state_not_found`.
 * Anchoring to `window.location.origin` (already a trusted origin) sends the
 * user back to the web app after the OAuth callback completes. Falls back to a
 * relative path when `window` is unavailable (SSR).
 */
export function buildAuthCallbackUrl(
  path: string,
  provider: AuthMethodId,
  returnUrl?: string,
): string {
  const params = new URLSearchParams({ provider });
  if (returnUrl) {
    params.set("returnUrl", sanitizeAuthRedirectPath(returnUrl, "/"));
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${path}?${params.toString()}`;
}

interface AuthOAuthRedirectPayload {
  redirect?: boolean;
  url?: string;
  data?: {
    redirect?: boolean;
    url?: string;
  };
}

export function getAuthOAuthRedirect(payload: unknown): {
  redirect: boolean;
  redirectUrl?: string;
} {
  if (!payload || typeof payload !== "object") {
    return { redirect: false };
  }

  const candidate = payload as AuthOAuthRedirectPayload;
  const redirect = candidate.redirect ?? candidate.data?.redirect;
  const redirectUrl = candidate.url ?? candidate.data?.url;

  if (redirect && redirectUrl) {
    return { redirect: true, redirectUrl };
  }

  return { redirect: false };
}

export function normalizeAuthReturnUrl(returnUrl: string | undefined): string {
  const normalized = returnUrl?.trim() || "";
  const sanitizedReturnUrl =
    normalized && normalized !== "/" ? normalized : undefined;

  return sanitizeAuthRedirectPath(sanitizedReturnUrl, "/");
}

type OAuthConsentParamRecord = Partial<
  Record<(typeof OAUTH_CONSENT_QUERY_KEYS)[number], string | undefined>
>;

function normalizeOAuthConsentQueryValue(key: string, value: string): string {
  // Better Auth signs with standard base64. Its magic-link verifier decodes an
  // already-parsed callback URL, turning `%2B` into `+`; subsequent form-style
  // query parsing turns that `+` into a space. Restore the signature before
  // serializing it back to `%2B`.
  return key === "sig" ? value.replaceAll(" ", "+") : value;
}

export function serializeOAuthConsentSearchParams(
  searchParams: URLSearchParams,
): string {
  const normalizedSearchParams = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    normalizedSearchParams.append(
      key,
      normalizeOAuthConsentQueryValue(key, value),
    );
  }

  return normalizedSearchParams.toString();
}

export function buildSignedOAuthConsentQueryFromSearchParams(
  searchParams: URLSearchParams,
): string | undefined {
  if (
    !searchParams.has("client_id") ||
    !searchParams.has("exp") ||
    !searchParams.has("sig")
  ) {
    return undefined;
  }

  const signedParameterNames = new Set(
    searchParams.getAll(SIGNED_OAUTH_QUERY_PARAMETER_NAMES_KEY),
  );
  const signedSearchParams = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    const isSignedParameter =
      signedParameterNames.size === 0 ||
      key === "sig" ||
      key === SIGNED_OAUTH_QUERY_PARAMETER_NAMES_KEY ||
      signedParameterNames.has(key);

    if (isSignedParameter && !AUTH_REDIRECT_EXCLUDED_QUERY_KEYS.has(key)) {
      signedSearchParams.append(key, value);
    }
  }

  return serializeOAuthConsentSearchParams(signedSearchParams);
}

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
      searchParams.set(key, normalizeOAuthConsentQueryValue(key, value));
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

  const signedOAuthQuery =
    buildSignedOAuthConsentQueryFromSearchParams(filteredSearchParams);

  if (signedOAuthQuery) {
    return `${OAUTH_CONSENT_PATH}?${signedOAuthQuery}`;
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
