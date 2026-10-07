import {
  type AuthEnvironment,
  type AuthManager,
} from "../auth/auth-manager.js";
import { COWORKER_API_KEY_PREFIX, PREPROD_API_URL } from "../auth/config.js";
import { redactErrorMessage, redactSensitive } from "../error-redaction.js";

export interface CoreHttpClientOptions {
  apiUrl: string;
  authManager: AuthManager;
  environment?: AuthEnvironment;
  clientId?: string;
  authBaseUrl?: string;
  clientSecret?: string;
  organizationSlug?: string;
  fetchImpl?: typeof fetch;
}

export interface CoreHttpClient {
  get<T>(pathname: string, signal?: AbortSignal): Promise<T>;
  post<T>(pathname: string, body: unknown, signal?: AbortSignal): Promise<T>;
  put<T>(pathname: string, body: unknown, signal?: AbortSignal): Promise<T>;
  patch<T>(pathname: string, body: unknown, signal?: AbortSignal): Promise<T>;
}

interface HttpClientOptions {
  resolveUrl: (pathname: string) => string;
  getToken: () => string | null | Promise<string | null>;
  fetchImpl: typeof fetch;
  organizationSlug?: string;
  rejectRedirects?: boolean;
  contextUserId?: string;
}

export function validateOrganizationSlug(value: string): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error(
      "Organization slug must contain only letters, numbers, underscores, or hyphens",
    );
  }
  const slug = value.trim();
  if (!/^[a-zA-Z0-9_-]+$/u.test(slug)) {
    throw new Error(
      "Organization slug must contain only letters, numbers, underscores, or hyphens",
    );
  }
  return slug;
}

function formatBody(body: unknown): string {
  if (body === undefined) return "no response body";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body) ?? String(body);
  } catch {
    return String(body);
  }
}

export function createApiError(
  status: number,
  body: unknown,
  knownSecrets: readonly string[] = [],
): Error {
  const safeBody = redactSensitive(body, knownSecrets);
  const error = new Error(
    `Core API request failed with status ${status}: ${formatBody(safeBody)}`,
  );
  error.name = "CoreApiError";
  Object.defineProperties(error, {
    status: { value: status, enumerable: true },
    body: { value: safeBody, enumerable: true },
  });
  return error;
}

function joinUrl(apiUrl: string, pathname: string): string {
  const base = apiUrl.trim().replace(/\/+$/g, "");
  const path = pathname.trim().replace(/^\/+/, "");
  return `${base}/${path}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `Core API returned invalid JSON (status ${response.status})`,
    );
  }
}

function createHttpClient({
  resolveUrl,
  getToken,
  fetchImpl,
  organizationSlug,
  rejectRedirects = false,
  contextUserId,
}: HttpClientOptions): CoreHttpClient {
  async function request<T>(
    method: string,
    pathname: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = resolveUrl(pathname);
    const token = await getToken();
    let response: Response;
    let parsedBody: unknown;
    try {
      const headers = new Headers({ Accept: "application/json" });
      if (organizationSlug)
        headers.set("X-Organization-Slug", organizationSlug);
      if (contextUserId) headers.set("X-Context-User-Id", contextUserId);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (body !== undefined) headers.set("Content-Type", "application/json");
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        ...(rejectRedirects ? { redirect: "error" as const } : {}),
      });
      if (
        rejectRedirects &&
        (response.redirected ||
          (response.status >= 300 && response.status < 400))
      ) {
        throw new Error("Coworker runtime requests must not redirect");
      }
      parsedBody = await readResponseBody(response);
    } catch (error) {
      if (!rejectRedirects) throw error;
      throw new Error(redactErrorMessage(error, token ? [token] : []));
    }
    if (!response.ok) {
      throw createApiError(response.status, parsedBody, token ? [token] : []);
    }
    return parsedBody as T;
  }

  return {
    get: <T>(pathname: string, signal?: AbortSignal) =>
      request<T>("GET", pathname, undefined, signal),
    post: <T>(pathname: string, body: unknown, signal?: AbortSignal) =>
      request<T>("POST", pathname, body, signal),
    put: <T>(pathname: string, body: unknown, signal?: AbortSignal) =>
      request<T>("PUT", pathname, body, signal),
    patch: <T>(pathname: string, body: unknown, signal?: AbortSignal) =>
      request<T>("PATCH", pathname, body, signal),
  };
}

export function createCoreHttpClient({
  apiUrl,
  authManager,
  environment,
  clientId,
  authBaseUrl,
  clientSecret,
  organizationSlug,
  fetchImpl = fetch,
}: CoreHttpClientOptions): CoreHttpClient {
  return createHttpClient({
    resolveUrl: (pathname) => joinUrl(apiUrl, pathname),
    organizationSlug:
      organizationSlug === undefined
        ? undefined
        : validateOrganizationSlug(organizationSlug),
    getToken: () =>
      authManager.getAuthTokenAsync({
        authBaseUrl,
        clientId,
        clientSecret,
        environment,
      }),
    fetchImpl,
  });
}

function coworkerRequestUrl(pathname: string): string {
  const errorMessage = "Coworker runtime requests require a /v1/ Core path";
  if (!pathname.startsWith("/v1/") || /[\s\\#]/u.test(pathname)) {
    throw new Error(errorMessage);
  }
  for (const segment of pathname.split("?", 1)[0].split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(errorMessage);
    }
    if (decoded === "." || decoded === ".." || /[\\/%]/u.test(decoded)) {
      throw new Error(errorMessage);
    }
  }
  return `${PREPROD_API_URL}${pathname}`;
}

export function createCoworkerHttpClient({
  apiKey,
  fetchImpl = fetch,
  contextUserId,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  contextUserId?: string;
}): CoreHttpClient {
  if (
    typeof apiKey !== "string" ||
    !apiKey.startsWith(COWORKER_API_KEY_PREFIX) ||
    apiKey.length === COWORKER_API_KEY_PREFIX.length ||
    /\s/u.test(apiKey)
  ) {
    throw new Error(
      "Coworker runtime requires a nonempty coworker_* API key without whitespace",
    );
  }
  if (
    contextUserId !== undefined &&
    (!contextUserId.trim() || /[\p{Cc}\p{Cf}]/u.test(contextUserId))
  )
    throw new Error("Invalid Coworker personal context user ID");
  return createHttpClient({
    resolveUrl: coworkerRequestUrl,
    getToken: () => apiKey,
    fetchImpl,
    rejectRedirects: true,
    contextUserId,
  });
}
