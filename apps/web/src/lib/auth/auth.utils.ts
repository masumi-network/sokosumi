import type { AuthMethodId } from "@/lib/schemas/auth";

const AUTH_SESSION_INITIAL_WAIT_MS = 200;
const AUTH_SESSION_RETRY_WAIT_MS = 500;
const AUTH_SESSION_GET_TIMEOUT_MS = 5_000;
// `error` and `error_description` are what a failed sign-in brings back to the
// page (see `buildAuthErrorCallbackUrl`), not part of the OAuth request.
const AUTH_ERROR_QUERY_KEYS = ["error", "error_description"];
const AUTH_REDIRECT_EXCLUDED_QUERY_KEYS = new Set([
  "returnUrl",
  "email",
  ...AUTH_ERROR_QUERY_KEYS,
]);
const SIGNED_OAUTH_QUERY_PARAMETER_NAMES_KEY = "ba_param";

interface WaitForAuthSessionOptions<TSession = unknown> {
  context: "login" | "signup";
  getSession: () => Promise<TSession | null>;
  logWarning: (message: string) => void;
  initialDelayMs?: number;
  retryDelayMs?: number;
  sessionTimeoutMs?: number;
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

async function getSessionOrNull<TSession>(
  getSession: () => Promise<TSession | null>,
  timeoutMs: number,
): Promise<TSession | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => getSession())
        .catch(() => null),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function createAuthSessionGetter<TSession>(
  getSessionResponse: () => Promise<AuthSessionResponse<TSession> | null>,
): () => Promise<TSession | null> {
  return async () => {
    const sessionResponse = await getSessionResponse();
    return sessionResponse?.data?.session ?? null;
  };
}

/**
 * Some sign-ins keep the document. `/auth/callback/*` leaves with
 * `router.replace` and re-authentication does not navigate at all, so a client
 * the Ably singleton retired for a lost session stays in `globalThis` and
 * leaves the newly signed-in user with dead realtime until a manual reload.
 * Credential and passkey now replace the document, where this is a harmless
 * no-op — it runs before the unload.
 *
 * Call this from every path that ends with a new session: `waitForAuthSession`
 * covers the ones that then redirect, and the re-authentication dialog calls it
 * directly, because it has nothing to wait for and nowhere to go.
 *
 * Dynamic, and deliberately not awaited: this module is imported by server
 * routes and server pages too, and the Ably SDK must stay out of every bundle
 * that does not use realtime. A failure here costs the tab its realtime until
 * the next reload, which is what already happened, so it must not break a
 * sign-in.
 */
export function discardRetiredAblyRealtimeClientAfterSignIn(): void {
  if (typeof window === "undefined") {
    return;
  }

  void import("@/lib/ably/realtime-singleton.client")
    .then((module) => {
      module.discardRetiredAblyRealtimeClient();
    })
    .catch((error: unknown) => {
      console.error("Could not discard the retired Ably client", error);
    });
}

export async function waitForAuthSession<TSession = unknown>({
  context,
  getSession,
  logWarning,
  initialDelayMs = AUTH_SESSION_INITIAL_WAIT_MS,
  retryDelayMs = AUTH_SESSION_RETRY_WAIT_MS,
  sessionTimeoutMs = AUTH_SESSION_GET_TIMEOUT_MS,
  waitForMs: waitForMsFn = waitForMs,
}: WaitForAuthSessionOptions<TSession>): Promise<TSession | null> {
  discardRetiredAblyRealtimeClientAfterSignIn();

  await waitForMsFn(initialDelayMs);

  const session = await getSessionOrNull(getSession, sessionTimeoutMs);
  if (session) {
    return session;
  }

  logWarning(
    `Session not established after ${context}, waiting for ${retryDelayMs}ms`,
  );
  await waitForMsFn(retryDelayMs);

  const retrySession = await getSessionOrNull(getSession, sessionTimeoutMs);
  if (!retrySession) {
    logWarning(
      `Session not established after ${context}, proceeding with redirect anyway`,
    );
  }
  return retrySession ?? null;
}

interface BuildAuthPageUrlParams {
  returnUrl?: string;
  email?: string;
  /** A signed OAuth request. It travels as the page's own query. */
  oauthQuery?: string;
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

function buildAuthPageUrl(
  path: "/signin" | "/signup",
  { returnUrl, email, oauthQuery }: BuildAuthPageUrlParams,
): string {
  const searchParams = new URLSearchParams(oauthQuery);

  if (returnUrl) {
    searchParams.set("returnUrl", returnUrl);
  }
  if (email) {
    searchParams.set("email", email);
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export function buildSignUpUrlFromSignIn(
  params: BuildAuthPageUrlParams,
): string {
  return buildAuthPageUrl("/signup", params);
}

// No email: sign-in locks a prefilled email field, so a typed sign-up email
// would trap a person who meant to use another account. A typed email goes
// over as an editable starting value instead: see `sign-in-email-hint.ts`.
export function buildSignInUrlFromSignUp({
  returnUrl,
  oauthQuery,
}: Pick<BuildAuthPageUrlParams, "returnUrl" | "oauthQuery">): string {
  return buildAuthPageUrl("/signin", { returnUrl, oauthQuery });
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
 * Builds an absolute auth callback URL for Better Auth `callbackURL` /
 * `newUserCallbackURL` (social, credential).
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

/**
 * Better Auth `errorCallbackURL` for social sign-in: the page the person
 * started on, which explains the `error` Better Auth appends. Without it a
 * failure lands on Core's bare error page. `pathname` sends
 * the failure to another auth page with the same query instead, for a page
 * that would only start the sign-in again.
 */
export function buildAuthErrorCallbackUrl(
  pathname?: string,
): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const url = new URL(window.location.href);
  if (pathname) {
    url.pathname = pathname;
  }
  for (const key of AUTH_ERROR_QUERY_KEYS) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  return url.href;
}

export function normalizeAuthReturnUrl(returnUrl: string | undefined): string {
  const normalized = returnUrl?.trim() || "";
  const sanitizedReturnUrl =
    normalized && normalized !== "/" ? normalized : undefined;

  return sanitizeAuthRedirectPath(sanitizedReturnUrl, "/");
}

function normalizeOAuthQueryValue(key: string, value: string): string {
  // Better Auth signs with standard base64. A `+` that reaches the query
  // unescaped parses as a space under form-style parsing. Restore the
  // signature before serializing it back to `%2B`.
  return key === "sig" ? value.replaceAll(" ", "+") : value;
}

export function serializeOAuthSearchParams(
  searchParams: URLSearchParams,
): string {
  const normalizedSearchParams = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    normalizedSearchParams.append(key, normalizeOAuthQueryValue(key, value));
  }

  return normalizedSearchParams.toString();
}

export function buildSignedOAuthQueryFromSearchParams(
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

  return serializeOAuthSearchParams(signedSearchParams);
}

/**
 * The signed request asks the person to sign in again (`prompt=login`, or a
 * `max_age`), even when they already have a session.
 */
export function oauthRequestRequiresSignIn(oauthQuery: string): boolean {
  return (
    new URLSearchParams(oauthQuery).has("max_age") ||
    hasOAuthPrompt(oauthQuery, "login")
  );
}

/**
 * Less of the signed request's life is left than a new sign-in or sign-up
 * takes. Core signs a request for ten minutes (`exp`, in seconds, from its
 * `codeExpiresIn`) and refuses it afterwards.
 */
const OAUTH_REQUEST_MIN_REMAINING_MS = 2 * 60_000;

export function oauthRequestExpiresSoon(oauthQuery: string): boolean {
  const expiresAt = Number(new URLSearchParams(oauthQuery).get("exp")) * 1000;
  return !(expiresAt - Date.now() > OAUTH_REQUEST_MIN_REMAINING_MS);
}

function hasOAuthPrompt(oauthQuery: string, prompt: string): boolean {
  return (
    new URLSearchParams(oauthQuery)
      .get("prompt")
      ?.split(" ")
      .includes(prompt) ?? false
  );
}

/**
 * The signed request comes from a product's "Create account"
 * (`prompt=create`).
 */
export function oauthRequestAsksForNewAccount(oauthQuery: string): boolean {
  return hasOAuthPrompt(oauthQuery, "create");
}

/**
 * Where a person with an OAuth request goes when a sign-in leaves the page
 * (a social sign-in the OAuth provider did not answer): the
 * sign-in page with the signed request as its own query. Arriving there signed
 * in hands the request back to the provider. Explicit reauthentication resumes
 * at consent, whose provider endpoint checks that the new session satisfies
 * the signed request before clearing its login prompt or maximum age.
 */
export function buildOAuthResumeUrlFromSearchParams(
  searchParams: URLSearchParams,
): string | undefined {
  const oauthQuery = buildSignedOAuthQueryFromSearchParams(searchParams);
  if (!oauthQuery) return undefined;

  if (oauthRequestRequiresSignIn(oauthQuery)) {
    return `/oauth/consent?${oauthQuery}`;
  }

  return buildAuthPageUrl("/signin", { oauthQuery });
}

/**
 * Core's OAuth provider refused the signed OAuth request the page carries: it
 * is older than ten minutes, or it was altered. Retrying cannot succeed; the
 * person has to start again from the product that sent them.
 */
export function isRejectedOAuthRequestError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    error.error === "invalid_signature"
  );
}
