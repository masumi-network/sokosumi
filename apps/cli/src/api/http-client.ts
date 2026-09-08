import {
  type AuthEnvironment,
  type AuthManager,
} from "../auth/auth-manager.js";

export interface CoreHttpClientOptions {
  apiUrl: string;
  authManager: AuthManager;
  environment?: AuthEnvironment;
  clientId?: string;
  authBaseUrl?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
}

export interface CoreHttpClient {
  get<T>(pathname: string, signal?: AbortSignal): Promise<T>;
  post<T>(pathname: string, body: unknown, signal?: AbortSignal): Promise<T>;
  patch<T>(pathname: string, body: unknown, signal?: AbortSignal): Promise<T>;
  delete<T>(pathname: string, signal?: AbortSignal): Promise<T>;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS: Record<string, true> = {
  authorization: true,
  access_token: true,
  api_key: true,
  apikey: true,
  client_secret: true,
  password: true,
  refresh_token: true,
  secret: true,
  token: true,
};

function redactBody(value: unknown, secret?: string): unknown {
  if (typeof value === "string") {
    return secret && secret.length > 0
      ? value.split(secret).join(REDACTED)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactBody(item, secret));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        SENSITIVE_KEYS[key.toLowerCase()] === true
          ? REDACTED
          : redactBody(item, secret),
      ]),
    );
  }
  return value;
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

export function createApiError(status: number, body: unknown): Error {
  const safeBody = redactBody(body);
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

export function createCoreHttpClient({
  apiUrl,
  authManager,
  environment,
  clientId,
  authBaseUrl,
  clientSecret,
  fetchImpl = fetch,
}: CoreHttpClientOptions): CoreHttpClient {
  async function request<T>(
    method: string,
    pathname: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = await authManager.getAuthTokenAsync({
      authBaseUrl,
      clientId,
      clientSecret,
      environment,
    });
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (body !== undefined) headers.set("Content-Type", "application/json");

    const response = await fetchImpl(joinUrl(apiUrl, pathname), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const parsedBody = await readResponseBody(response);
    if (!response.ok) {
      const safeBody = redactBody(parsedBody, token ?? undefined);
      throw createApiError(response.status, safeBody);
    }
    return parsedBody as T;
  }

  return {
    get: <T>(pathname: string, signal?: AbortSignal) =>
      request<T>("GET", pathname, undefined, signal),
    post: <T>(pathname: string, body: unknown, signal?: AbortSignal) =>
      request<T>("POST", pathname, body, signal),
    patch: <T>(pathname: string, body: unknown, signal?: AbortSignal) =>
      request<T>("PATCH", pathname, body, signal),
    delete: <T>(pathname: string, signal?: AbortSignal) =>
      request<T>("DELETE", pathname, undefined, signal),
  };
}
