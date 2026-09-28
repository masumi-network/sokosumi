import {
  type AuthEnvironment,
  type AuthManager,
} from "../auth/auth-manager.js";
import { redactSensitive } from "../error-redaction.js";

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
  const selectedOrganizationSlug =
    organizationSlug === undefined
      ? undefined
      : validateOrganizationSlug(organizationSlug);

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
    if (selectedOrganizationSlug)
      headers.set("X-Organization-Slug", selectedOrganizationSlug);
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
