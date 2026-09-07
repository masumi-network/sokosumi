import { Composio } from "@composio/core";

import { getEnv } from "@/config/env";

let instance: Composio | null | undefined;

/** Shared Composio SDK client; `null` when no API key is configured. */
export function getComposio(): Composio | null {
  if (instance !== undefined) return instance;
  const env = getEnv();
  instance = env.COMPOSIO_API_KEY
    ? new Composio({
        apiKey: env.COMPOSIO_API_KEY,
        baseURL: env.COMPOSIO_API_BASE_URL ?? null,
        allowTracking: false,
      })
    : null;
  return instance;
}

export class ComposioConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioConfigError";
  }
}

export class ComposioApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Composio API error (${httpStatus})`);
    this.name = "ComposioApiError";
  }
}

export type ComposioConnectionStatus =
  | "INITIALIZING"
  | "INITIATED"
  | "ACTIVE"
  | "FAILED"
  | "EXPIRED"
  | "INACTIVE"
  | "REVOKED";

export interface ConnectedXIdentity {
  id: string;
  handle: string | null;
}

export interface ProjectXConnectedAccount {
  id: string;
  status: ComposioConnectionStatus;
  toolkitSlug: string;
  authConfigId: string;
  connectorUserId: string | null;
}

export interface InitiateConnectionResult {
  connectionId: string;
  redirectUrl: string;
}

interface ComposioConnectedAccountResponse {
  auth_config?: { id?: string };
  id?: string;
  state?: { status?: string };
  status?: string;
  toolkit?: { slug?: string };
  user_id?: string;
}

const CONNECT_LINK_HOST = "connect.composio.dev";

function getProjectComposioConfig(): { apiKey: string; baseUrl: string } {
  const env = getEnv();
  if (!env.COMPOSIO_API_KEY) {
    throw new ComposioConfigError("COMPOSIO_API_KEY is not configured");
  }
  return {
    apiKey: env.COMPOSIO_API_KEY,
    baseUrl: env.COMPOSIO_API_BASE_URL ?? "https://backend.composio.dev",
  };
}

async function projectComposioFetch(
  path: string,
  init: { jsonBody?: unknown } & RequestInit = {},
): Promise<Response> {
  const { apiKey, baseUrl } = getProjectComposioConfig();
  const { jsonBody, headers: initHeaders, ...requestInit } = init;
  const headers = new Headers(initHeaders);
  headers.set("x-api-key", apiKey);
  if (jsonBody !== undefined) headers.set("Content-Type", "application/json");
  try {
    return await fetch(new URL(path, baseUrl), {
      ...requestInit,
      body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new ComposioApiError(503, undefined, "Composio API timed out");
    }
    throw error;
  }
}

async function projectComposioResponse<T>(
  response: Response,
  context: string,
): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new ComposioApiError(
      response.status,
      undefined,
      `${context} failed (${response.status})`,
    );
  }
  return body as T;
}

function projectConnectionStatus(value: unknown): ComposioConnectionStatus {
  const status = typeof value === "string" ? value.toUpperCase() : "INITIATED";
  switch (status) {
    case "INITIALIZING":
    case "INITIATED":
    case "ACTIVE":
    case "FAILED":
    case "EXPIRED":
    case "INACTIVE":
    case "REVOKED":
      return status;
    default:
      return "INACTIVE";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function projectResponseError(response: Response, context: string): never {
  throw new ComposioApiError(
    response.status,
    undefined,
    `${context} returned an invalid response`,
  );
}

function validateConnectLinkRedirectUrl(redirectUrl: string): string {
  const { baseUrl } = getProjectComposioConfig();
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    throw new ComposioApiError(
      503,
      undefined,
      "initiate Project X connection returned an unsafe redirect URL",
    );
  }

  const allowedHosts = new Set([new URL(baseUrl).hostname, CONNECT_LINK_HOST]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    throw new ComposioApiError(
      503,
      undefined,
      "initiate Project X connection returned an unsafe redirect URL",
    );
  }
  return url.toString();
}

export async function initiateProjectXConnection(input: {
  authConfigId: string;
  callbackUrl: string;
  connectorUserId: string;
  executorUserId: string;
}): Promise<InitiateConnectionResult> {
  const response = await projectComposioFetch(
    "/api/v3.1/connected_accounts/link",
    {
      method: "POST",
      jsonBody: {
        auth_config_id: input.authConfigId,
        user_id: input.connectorUserId,
        callback_url: input.callbackUrl,
        experimental: {
          account_type: "SHARED",
          acl_config_for_shared: { allowed_user_ids: [input.executorUserId] },
        },
      },
    },
  );
  const body = await projectComposioResponse<{
    connected_account_id?: string;
    connectedAccountId?: string;
    id?: string;
    redirect_url?: string;
    redirectUrl?: string;
  }>(response, "initiate Project X connection");
  const connectionId =
    body.connected_account_id ?? body.connectedAccountId ?? body.id;
  const redirectUrl = body.redirect_url ?? body.redirectUrl;
  if (!connectionId || !redirectUrl)
    projectResponseError(response, "initiate Project X connection");
  return {
    connectionId,
    redirectUrl: validateConnectLinkRedirectUrl(redirectUrl),
  };
}

export async function completeComposioAuth(input: {
  sessionUri: string;
  userId: string;
}): Promise<{ connectedAccountId: string; toolkitSlug: string }> {
  const response = await projectComposioFetch(
    "/api/v3.1/connected_accounts/complete_auth",
    {
      method: "POST",
      jsonBody: { session_uri: input.sessionUri, user_id: input.userId },
    },
  );
  const body = await projectComposioResponse<{
    connected_account?: { id?: string; toolkit?: { slug?: string } };
    connected_account_id?: string;
    connectedAccountId?: string;
    id?: string;
    toolkit?: { slug?: string };
    toolkit_slug?: string;
  }>(response, "complete Composio callback authentication");
  const connectedAccountId =
    body.connected_account_id ??
    body.connectedAccountId ??
    body.connected_account?.id ??
    body.id;
  const toolkitSlug =
    body.toolkit_slug ??
    body.toolkit?.slug ??
    body.connected_account?.toolkit?.slug;
  if (!connectedAccountId || !toolkitSlug)
    projectResponseError(response, "complete Composio callback authentication");
  return { connectedAccountId, toolkitSlug };
}

export async function getProjectXConnectedAccount(
  connectedAccountId: string,
): Promise<ProjectXConnectedAccount> {
  const response = await projectComposioFetch(
    `/api/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
  );
  const body = await projectComposioResponse<ComposioConnectedAccountResponse>(
    response,
    "get Project X connection",
  );
  const toolkitSlug = body.toolkit?.slug?.toLowerCase();
  if (!body.id || !toolkitSlug || !body.auth_config?.id)
    projectResponseError(response, "get Project X connection");
  return {
    id: body.id,
    status: projectConnectionStatus(body.status ?? body.state?.status),
    toolkitSlug,
    authConfigId: body.auth_config.id,
    connectorUserId: body.user_id ?? null,
  };
}

export async function getConnectedXIdentity(input: {
  connectedAccountId: string;
  executorUserId: string;
}): Promise<ConnectedXIdentity> {
  const createResponse = await projectComposioFetch(
    "/api/v3.1/tool_router/session",
    {
      method: "POST",
      jsonBody: {
        user_id: input.executorUserId,
        toolkits: ["twitter"],
        connected_accounts: { twitter: [input.connectedAccountId] },
        manage_connections: { enable: false, enable_connection_removal: false },
        tools: { twitter: { enable: ["TWITTER_USER_LOOKUP_ME"] } },
        workbench: { enable: false, enable_proxy_execution: false },
        search: { enable: false },
        execute: { enable_multi_execute: false },
      },
    },
  );
  const session = await projectComposioResponse<{ session_id?: string }>(
    createResponse,
    "create Project X identity session",
  );
  if (!session.session_id)
    projectResponseError(createResponse, "create Project X identity session");
  try {
    const response = await projectComposioFetch(
      `/api/v3.1/tool_router/session/${encodeURIComponent(session.session_id)}/execute`,
      {
        method: "POST",
        jsonBody: { tool_slug: "TWITTER_USER_LOOKUP_ME", arguments: {} },
      },
    );
    const result = await projectComposioResponse<{
      data?: unknown;
      error?: string | null;
    }>(response, "look up Project X identity");
    const toolResult = record(result.data);
    const providerResult = record(toolResult?.data) ?? toolResult;
    const identity = record(providerResult?.data) ?? providerResult;
    if (
      result.error ||
      !identity ||
      typeof identity.id !== "string" ||
      !identity.id
    ) {
      throw new ComposioApiError(
        response.status,
        undefined,
        "X identity lookup failed",
      );
    }
    return {
      id: identity.id,
      handle:
        typeof identity.username === "string"
          ? identity.username
          : typeof identity.handle === "string"
            ? identity.handle
            : null,
    };
  } finally {
    const response = await projectComposioFetch(
      `/api/v3.1/tool_router/session/${encodeURIComponent(session.session_id)}`,
      { method: "DELETE" },
    );
    await projectComposioResponse(
      response,
      "delete Project X identity session",
    );
  }
}

export async function revokeProjectXConnection(input: {
  connectedAccountId: string;
}): Promise<void> {
  const response = await projectComposioFetch(
    `/api/v3.1/connected_accounts/${encodeURIComponent(input.connectedAccountId)}/revoke`,
    { method: "POST" },
  );
  await projectComposioResponse(response, "revoke Project X connection");
}
