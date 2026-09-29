import { Composio } from "@composio/core";

import { getEnv } from "@/config/env";
import {
  PROJECT_SOCIAL_PROVIDERS,
  type ProjectSocialProvider,
} from "@/config/social-providers";
import { tryUseLogger } from "@/lib/evlog";

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
    const env = getEnv();
    tryUseLogger()?.set({
      composio: {
        failure: "missing_configuration",
        apiKeyConfigured: Boolean(env.COMPOSIO_API_KEY),
        authConfigsConfigured: Object.fromEntries(
          Object.entries(PROJECT_SOCIAL_PROVIDERS).map(([provider, config]) => [
            provider,
            Boolean(env[config.authConfigEnv]),
          ]),
        ),
      },
    });
  }
}

/** The provider's identity lookup succeeded but cannot be used as-is. */
export class ComposioIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioIdentityError";
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

export interface ConnectedSocialIdentity {
  id: string;
  handle: string | null;
}

export interface ProjectSocialConnectedAccount {
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

export async function projectComposioFetch(
  path: string,
  init: { jsonBody?: unknown; timeoutMs?: number } & RequestInit = {},
): Promise<Response> {
  const { apiKey, baseUrl } = getProjectComposioConfig();
  const {
    jsonBody,
    headers: initHeaders,
    signal,
    timeoutMs = 15_000,
    ...requestInit
  } = init;
  signal?.throwIfAborted();
  const headers = new Headers(initHeaders);
  headers.set("x-api-key", apiKey);
  if (jsonBody !== undefined) headers.set("Content-Type", "application/json");
  try {
    return await fetch(new URL(path, baseUrl), {
      ...requestInit,
      body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
      cache: "no-store",
      headers,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new ComposioApiError(503, undefined, "Composio API timed out");
    }
    throw new ComposioApiError(503, undefined, "Composio API request failed");
  }
}

/** Provider text can echo credentials. Only fixed diagnostic labels reach logs. */
function recordComposioResponseFailure(
  response: Response,
  operation: string,
  body: unknown,
  failure: "http_error" | "invalid_response",
): void {
  const payload = record(body);
  const error = record(payload?.error);
  const details = Array.isArray(payload?.detail)
    ? payload.detail.slice(0, 20)
    : [];
  const messages = [
    payload?.message,
    typeof payload?.error === "string" ? payload.error : undefined,
    error?.message,
    error?.code,
    payload?.detail,
    ...details.map((detail) => record(detail)?.msg),
  ].filter((value): value is string => typeof value === "string");
  const text = messages.map((value) => value.slice(0, 2000)).join(" ");
  const fields = {
    auth_config_id: /auth[ _-]?config/i,
    callback_url: /callback|redirect[ _-]?url/i,
    user_id: /user[ _-]?id/i,
    account_type: /account[ _-]?type|shared[ _-]?(?:account|connection)/i,
    acl_config_for_shared: /acl|allowed[ _-]?user/i,
    session_uri: /session[ _-]?uri/i,
  };
  const reasons = {
    not_found: /not[ _-]?found|does not exist/i,
    invalid: /invalid|validation/i,
    required: /required|missing/i,
    unsupported: /unsupported|not supported|not allowed/i,
    expired: /expired/i,
    disabled: /disabled/i,
    unauthorized: /unauthori[sz]ed|forbidden|permission|access denied/i,
  };
  const validationFields = details.flatMap((detail) => {
    const loc = record(detail)?.loc;
    return Array.isArray(loc)
      ? loc.filter(
          (part): part is string =>
            typeof part === "string" && Object.hasOwn(fields, part),
        )
      : [];
  });
  tryUseLogger()?.set({
    composio: {
      operation,
      failure,
      upstreamStatus: response.status,
      fields: Object.entries(fields)
        .filter(
          ([field, pattern]) =>
            pattern.test(text) || validationFields.includes(field),
        )
        .map(([field]) => field),
      reasons: Object.entries(reasons)
        .filter(([, pattern]) => pattern.test(text))
        .map(([reason]) => reason),
    },
  });
}

export async function projectComposioResponse<T>(
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
    recordComposioResponseFailure(response, context, body, "http_error");
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

export function record(value: unknown): Record<string, unknown> | null {
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

export function projectResponseError(
  response: Response,
  context: string,
): never {
  recordComposioResponseFailure(
    response,
    context,
    undefined,
    "invalid_response",
  );
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
      "initiate Project social connection returned an unsafe redirect URL",
    );
  }

  const allowedHosts = new Set([new URL(baseUrl).hostname, CONNECT_LINK_HOST]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    throw new ComposioApiError(
      503,
      undefined,
      "initiate Project social connection returned an unsafe redirect URL",
    );
  }
  return url.toString();
}

export async function initiateProjectSocialConnection(input: {
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
  }>(response, "initiate Project social connection");
  const connectionId =
    body.connected_account_id ?? body.connectedAccountId ?? body.id;
  const redirectUrl = body.redirect_url ?? body.redirectUrl;
  if (!connectionId || !redirectUrl)
    projectResponseError(response, "initiate Project social connection");
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

export async function getProjectSocialConnectedAccount(
  connectedAccountId: string,
): Promise<ProjectSocialConnectedAccount> {
  const response = await projectComposioFetch(
    `/api/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
  );
  const body = await projectComposioResponse<ComposioConnectedAccountResponse>(
    response,
    "get Project social connection",
  );
  const toolkitSlug = body.toolkit?.slug?.toLowerCase();
  if (!body.id || !toolkitSlug || !body.auth_config?.id)
    projectResponseError(response, "get Project social connection");
  return {
    id: body.id,
    status: projectConnectionStatus(body.status ?? body.state?.status),
    toolkitSlug,
    authConfigId: body.auth_config.id,
    connectorUserId: body.user_id ?? null,
  };
}

/**
 * Deletes a Composio tool-router session. Cleanup must never change the outcome
 * of the work the session did, so a failed delete is logged, not raised.
 */
export async function deleteProjectSocialSession(
  sessionId: string,
  context: string,
): Promise<void> {
  try {
    const response = await projectComposioFetch(
      `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    await projectComposioResponse(response, context);
  } catch {
    console.warn(`[composio] ${context} failed`);
  }
}

/** Identity-only tools from https://docs.composio.dev/toolkits/{toolkit}. */
const SOCIAL_IDENTITY_TOOLS: Record<
  ProjectSocialProvider,
  { slug: string; arguments: Record<string, unknown> }
> = {
  x: { slug: "TWITTER_USER_LOOKUP_ME", arguments: {} },
  tiktok: {
    slug: "TIKTOK_GET_USER_STATS",
    arguments: { fields: ["open_id", "display_name"] },
  },
  instagram: {
    slug: "INSTAGRAM_GET_USER_INFO",
    arguments: { ig_user_id: "me", fields: "id,username" },
  },
  linkedin: { slug: "LINKEDIN_GET_MY_INFO", arguments: {} },
  facebook: {
    slug: "FACEBOOK_LIST_MANAGED_PAGES",
    arguments: { fields: "id,name", limit: 2 },
  },
  youtube: {
    slug: "YOUTUBE_LIST_CHANNELS",
    arguments: { mine: true, part: "id,snippet", maxResults: 2 },
  },
};

function identityString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Check every Composio/provider envelope before unwrapping its data. */
function socialIdentityPayload(
  value: unknown,
  provider: ProjectSocialProvider,
): Record<string, unknown> | null {
  let payload = record(value);
  for (let depth = 0; payload && depth < 5; depth++) {
    const error = payload.error;
    const isTikTokSuccess =
      provider === "tiktok" && record(error)?.code === "ok";
    if (
      payload.successful === false ||
      payload.success === false ||
      (error && !isTikTokSuccess)
    ) {
      return null;
    }
    const data = record(payload.data);
    if (!data) return payload;
    payload = data;
  }
  return null;
}

function socialIdentity(
  provider: ProjectSocialProvider,
  payload: Record<string, unknown>,
): ConnectedSocialIdentity | null {
  let identity = payload;
  let id: string | null;
  let handle: string | null;
  switch (provider) {
    case "tiktok":
      // TikTok v2 user/info returns data.user and error.code = "ok".
      identity = record(payload.user) ?? {};
      id = identityString(identity.open_id);
      handle = identityString(identity.display_name);
      break;
    case "linkedin": {
      // Composio also documents response_dict.author_id as the person URN.
      const profile = record(payload.response_dict) ?? payload;
      id =
        identityString(profile.author_id) ??
        identityString(profile.sub) ??
        identityString(profile.id);
      handle =
        identityString(profile.vanityName) ?? identityString(profile.name);
      break;
    }
    case "youtube": {
      // Never select an arbitrary channel when OAuth exposes several channels.
      if (
        !Array.isArray(payload.items) ||
        payload.items.length !== 1 ||
        payload.nextPageToken
      ) {
        return null;
      }
      identity = record(payload.items[0]) ?? {};
      id = identityString(identity.id);
      const snippet = record(identity.snippet);
      handle =
        identityString(snippet?.customUrl) ?? identityString(snippet?.title);
      break;
    }
    case "facebook": {
      // Posts go to a Page; never choose one when the account manages none or several.
      const pages = Array.isArray(identity.data)
        ? identity.data
        : Array.isArray(identity.items)
          ? identity.items
          : null;
      if (!pages || pages.length !== 1) return null;
      const paging = record(identity.paging);
      if (paging && identityString(paging.next)) return null;
      const page = record(pages[0]) ?? {};
      id = identityString(page.id);
      handle = identityString(page.name);
      break;
    }
    case "instagram":
      id = identityString(identity.id);
      handle = identityString(identity.username);
      break;
    case "x":
      id = identityString(identity.id);
      handle =
        identityString(identity.username) ?? identityString(identity.handle);
      break;
  }
  return id ? { id, handle } : null;
}

export async function getConnectedSocialIdentity(input: {
  provider: ProjectSocialProvider;
  connectedAccountId: string;
  executorUserId: string;
}): Promise<ConnectedSocialIdentity> {
  const { toolkitSlug, name } = PROJECT_SOCIAL_PROVIDERS[input.provider];
  const tool = SOCIAL_IDENTITY_TOOLS[input.provider];
  const context = `look up Project ${name} identity`;
  const createResponse = await projectComposioFetch(
    "/api/v3.1/tool_router/session",
    {
      method: "POST",
      jsonBody: {
        user_id: input.executorUserId,
        toolkits: { enable: [toolkitSlug] },
        connected_accounts: { [toolkitSlug]: [input.connectedAccountId] },
        manage_connections: { enable: false, enable_connection_removal: false },
        tools: { [toolkitSlug]: { enable: [tool.slug] } },
        workbench: { enable: false, enable_proxy_execution: false },
        search: { enable: false },
        execute: { enable_multi_execute: false },
      },
    },
  );
  const session = record(
    await projectComposioResponse<unknown>(
      createResponse,
      `create Project ${name} identity session`,
    ),
  );
  const sessionId = identityString(session?.session_id);
  if (!sessionId)
    projectResponseError(
      createResponse,
      `create Project ${name} identity session`,
    );
  try {
    const response = await projectComposioFetch(
      `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/execute`,
      {
        method: "POST",
        jsonBody: { tool_slug: tool.slug, arguments: tool.arguments },
      },
    );
    const result = await projectComposioResponse<unknown>(response, context);
    const payload = socialIdentityPayload(result, input.provider);
    const identity = payload ? socialIdentity(input.provider, payload) : null;
    if (!identity) {
      if (payload && input.provider === "facebook") {
        throw new ComposioIdentityError(
          "Facebook publishing needs an account that manages exactly one Page. Use an account with a single manageable Page.",
        );
      }
      throw new ComposioApiError(
        response.status,
        undefined,
        `${name} identity lookup failed`,
      );
    }
    return identity;
  } finally {
    await deleteProjectSocialSession(
      sessionId,
      `delete Project ${name} identity session`,
    );
  }
}

export async function revokeProjectSocialConnection(input: {
  connectedAccountId: string;
}): Promise<void> {
  const response = await projectComposioFetch(
    `/api/v3.1/connected_accounts/${encodeURIComponent(input.connectedAccountId)}/revoke`,
    { method: "POST" },
  );
  if (response.status === 404) return;
  if (response.status === 409) {
    const account = await getProjectSocialConnectedAccount(
      input.connectedAccountId,
    );
    if (account.status === "REVOKED") return;
  }
  await projectComposioResponse(response, "revoke Project social connection");
}

/** Permanently invalidates an unfinished OAuth link, including future redemption. */
export async function deleteProjectSocialConnectionIntent(input: {
  connectedAccountId: string;
}): Promise<void> {
  const response = await projectComposioFetch(
    `/api/v3.1/connected_accounts/${encodeURIComponent(input.connectedAccountId)}?revoke_on_delete=true`,
    { method: "DELETE" },
  );
  if (response.status === 404) return;
  await projectComposioResponse(
    response,
    "delete unfinished Project social connection",
  );
}
