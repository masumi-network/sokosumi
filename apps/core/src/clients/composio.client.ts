import { Composio } from "@composio/core";
import type { SocialPostMediaKind } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
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
        xAuthConfigConfigured: Boolean(env.COMPOSIO_X_AUTH_CONFIG_ID),
      },
    });
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

const TOOL_ERROR_MESSAGE_LIMIT = 300;

/** Redacts credentials and identifiers before a provider message is stored. */
function sanitizeProviderMessage(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bhttps?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/\bsess_[a-z0-9_-]+\b/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s"',;}\]]+/gi, "Bearer [redacted]")
    .replace(
      /(\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization|password|token|secret)\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
      (_match, prefix: string, value: string) => {
        const quote =
          value.startsWith('"') || value.startsWith("'") ? value[0] : "";
        return `${prefix}${quote}[redacted]${quote}`;
      },
    )
    .replace(/\b[a-z0-9_-]{32,}\b/gi, (candidate) =>
      /[a-z]/i.test(candidate) && /\d/.test(candidate)
        ? "[redacted-id]"
        : candidate,
    )
    .trim()
    .slice(0, TOOL_ERROR_MESSAGE_LIMIT);
}

/**
 * A tool executed through Composio but the provider refused or returned no
 * usable result. Carries only a sanitized provider message and status; never
 * the session id, tokens, or the raw payload.
 */
export class ComposioToolError extends Error {
  readonly providerMessage: string | null;
  readonly providerStatus: number | null;

  constructor(input: {
    message: string;
    providerMessage?: string | null;
    providerStatus?: number | null;
  }) {
    super(input.message);
    this.name = "ComposioToolError";
    this.providerMessage = input.providerMessage
      ? sanitizeProviderMessage(input.providerMessage)
      : null;
    this.providerStatus = input.providerStatus ?? null;
  }
}

/** The create-post request may have succeeded; repeating it could publish twice. */
export class ComposioPublishOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The publishing result could not be confirmed. Check X before retrying to avoid a duplicate post.",
    );
    this.name = "ComposioPublishOutcomeUnknownError";
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

export interface PublishedXPost {
  externalId: string;
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

/**
 * Deletes a Composio tool-router session. Cleanup must never change the outcome
 * of the work the session did, so a failed delete is logged, not raised.
 */
async function deleteProjectXSession(
  sessionId: string,
  context: string,
): Promise<void> {
  try {
    const response = await projectComposioFetch(
      `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    await projectComposioResponse(response, context);
  } catch (error) {
    console.warn(`[composio] ${context} failed`, error);
  }
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
        toolkits: { enable: ["twitter"] },
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
    await deleteProjectXSession(
      session.session_id,
      "delete Project X identity session",
    );
  }
}

const X_CREATE_POST_TOOL_SLUG = "TWITTER_CREATION_OF_A_POST";

function toolErrorMessage(value: unknown): string | null {
  if (typeof value === "string") return value;
  const detail = record(value);
  if (!detail) return null;
  for (const key of ["message", "detail", "error", "title"]) {
    const candidate = detail[key];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

function toolErrorStatus(value: unknown): number | null {
  const detail = record(value);
  if (!detail) return null;
  for (const key of ["status", "status_code", "statusCode"]) {
    const candidate = detail[key];
    if (typeof candidate === "number") return candidate;
  }
  return null;
}

type XPublishToolSlug =
  | "TWITTER_INITIALIZE_MEDIA_UPLOAD"
  | "TWITTER_APPEND_MEDIA_UPLOAD"
  | "TWITTER_FINALIZE_MEDIA_UPLOAD"
  | "TWITTER_GET_MEDIA_UPLOAD_STATUS"
  | typeof X_CREATE_POST_TOOL_SLUG;

/** Tools a publish session may execute, with the wording used when each fails. */
const X_PUBLISH_TOOL_STEPS: Record<
  XPublishToolSlug,
  { context: string; refused: string }
> = {
  TWITTER_INITIALIZE_MEDIA_UPLOAD: {
    context: "initialize X media upload",
    refused: "X refused the media upload",
  },
  TWITTER_APPEND_MEDIA_UPLOAD: {
    context: "append X media upload",
    refused: "X refused a media chunk",
  },
  TWITTER_FINALIZE_MEDIA_UPLOAD: {
    context: "finalize X media upload",
    refused: "X refused to finalize the media upload",
  },
  TWITTER_GET_MEDIA_UPLOAD_STATUS: {
    context: "check X media upload status",
    refused: "X refused the media status check",
  },
  [X_CREATE_POST_TOOL_SLUG]: {
    context: "publish X post",
    refused: "X refused the post",
  },
};
const X_PUBLISH_TOOL_SLUGS = Object.keys(
  X_PUBLISH_TOOL_STEPS,
) as XPublishToolSlug[];

/** X accepts media in chunks of at most 4 MiB. */
const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const MEDIA_PROCESSING_DEFAULT_WAIT_MS = 2_000;
/** X can take up to two minutes to process a video or GIF. */
const MEDIA_PROCESSING_TIMEOUT_MS = 120_000;

export interface PublishXMediaInput {
  bytes: Uint8Array;
  mimeType: string;
  kind: SocialPostMediaKind;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mediaCategory(kind: SocialPostMediaKind): string {
  switch (kind) {
    case "image":
      return "tweet_image";
    case "gif":
      return "tweet_gif";
    case "video":
      return "tweet_video";
  }
}

/**
 * X media id from a tool payload. Prefers the string shape: a 17–19 digit id
 * returned as a JSON number would lose precision.
 */
function mediaIdOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.media_id_string, data?.media_id, data?.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
      return String(candidate);
    }
  }
  return null;
}

/**
 * Executes one tool in a publish session and returns the provider payload with
 * Composio's envelope layers stripped. A refused or unsuccessful execution is
 * raised as a {@link ComposioToolError}.
 */
async function executePublishTool(
  sessionId: string,
  toolSlug: XPublishToolSlug,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const step = X_PUBLISH_TOOL_STEPS[toolSlug];
  const response = await projectComposioFetch(
    `/api/v3.1/tool_router/session/${encodeURIComponent(sessionId)}/execute`,
    { method: "POST", jsonBody: { tool_slug: toolSlug, arguments: args } },
  );
  const result = await projectComposioResponse<{
    data?: unknown;
    error?: unknown;
    successful?: boolean;
  }>(response, step.context);
  const toolResult = record(result.data);
  const providerResult = record(toolResult?.data) ?? toolResult;
  const toolError = result.error ?? toolResult?.error;
  if (toolError || result.successful === false) {
    throw new ComposioToolError({
      message: step.refused,
      providerMessage: toolErrorMessage(toolError),
      providerStatus: toolErrorStatus(toolError),
    });
  }
  return record(providerResult?.data) ?? providerResult;
}

function processingState(
  data: Record<string, unknown> | null,
): { state: string; waitMs: number; errorMessage: string | null } | null {
  const info = record(data?.processing_info);
  if (!info || typeof info.state !== "string") return null;
  const checkAfter = info.check_after_secs;
  return {
    state: info.state.toLowerCase(),
    waitMs:
      typeof checkAfter === "number" && checkAfter >= 0
        ? checkAfter * 1000
        : MEDIA_PROCESSING_DEFAULT_WAIT_MS,
    errorMessage: toolErrorMessage(info.error),
  };
}

/** Finalizes a media upload; Composio mirrors X v2 but the id parameter name has varied. */
async function finalizeMediaUpload(
  sessionId: string,
  mediaId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await executePublishTool(
      sessionId,
      "TWITTER_FINALIZE_MEDIA_UPLOAD",
      { id: mediaId },
    );
  } catch (error) {
    if (!(error instanceof ComposioToolError)) throw error;
    try {
      const result = await executePublishTool(
        sessionId,
        "TWITTER_FINALIZE_MEDIA_UPLOAD",
        { media_id: mediaId },
      );
      console.info(
        "[composio] TWITTER_FINALIZE_MEDIA_UPLOAD accepted media_id, not id",
      );
      return result;
    } catch {
      throw error;
    }
  }
}

/** Waits for X to finish processing a media upload, polling within a bounded window. */
async function awaitMediaProcessing(
  sessionId: string,
  mediaId: string,
  finalizeResult: Record<string, unknown> | null,
): Promise<void> {
  let processing = processingState(finalizeResult);
  const startedAt = Date.now();
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new ComposioToolError({
        message: "X could not process the media",
        providerMessage: processing.errorMessage ?? "Media processing failed",
      });
    }
    const remainingMs = MEDIA_PROCESSING_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new ComposioToolError({
        message: "X media processing timed out",
        providerMessage: "Media processing timed out",
      });
    }
    await sleep(Math.min(processing.waitMs, remainingMs));
    processing = processingState(
      await executePublishTool(sessionId, "TWITTER_GET_MEDIA_UPLOAD_STATUS", {
        media_id: mediaId,
      }),
    );
  }
}

async function uploadXMedia(
  sessionId: string,
  media: PublishXMediaInput,
): Promise<string> {
  const initialized = await executePublishTool(
    sessionId,
    "TWITTER_INITIALIZE_MEDIA_UPLOAD",
    {
      media_type: media.mimeType,
      total_bytes: media.bytes.length,
      media_category: mediaCategory(media.kind),
    },
  );
  const mediaId = mediaIdOf(initialized);
  if (!mediaId) {
    throw new ComposioToolError({
      message: "X media upload returned no media id",
    });
  }

  for (
    let offset = 0, segment = 0;
    offset < media.bytes.length;
    offset += MEDIA_CHUNK_BYTES, segment += 1
  ) {
    const chunk = media.bytes.subarray(offset, offset + MEDIA_CHUNK_BYTES);
    await executePublishTool(sessionId, "TWITTER_APPEND_MEDIA_UPLOAD", {
      id: mediaId,
      media: Buffer.from(chunk).toString("base64"),
      segment_index: segment,
    });
  }

  const finalized = await finalizeMediaUpload(sessionId, mediaId);
  await awaitMediaProcessing(sessionId, mediaId, finalized);
  return mediaId;
}

/**
 * Publishes a post to X through a restricted tool-router session pinned to one
 * connected account with only the media-upload and create-post tools enabled.
 * Media bytes are uploaded inside the same session and referenced by id; the
 * ids never leave this call. The session is deleted once the call settles,
 * whatever the outcome.
 */
export async function publishXPost(input: {
  connectedAccountId: string;
  executorUserId: string;
  text: string;
  media: PublishXMediaInput[];
}): Promise<PublishedXPost> {
  const createResponse = await projectComposioFetch(
    "/api/v3.1/tool_router/session",
    {
      method: "POST",
      jsonBody: {
        user_id: input.executorUserId,
        toolkits: { enable: ["twitter"] },
        connected_accounts: { twitter: [input.connectedAccountId] },
        manage_connections: { enable: false, enable_connection_removal: false },
        tools: { twitter: { enable: [...X_PUBLISH_TOOL_SLUGS] } },
        workbench: { enable: false, enable_proxy_execution: false },
        search: { enable: false },
        execute: { enable_multi_execute: false },
      },
    },
  );
  const session = await projectComposioResponse<{ session_id?: string }>(
    createResponse,
    "create Project X publish session",
  );
  if (!session.session_id)
    projectResponseError(createResponse, "create Project X publish session");
  try {
    const mediaIds: string[] = [];
    for (const media of input.media) {
      mediaIds.push(await uploadXMedia(session.session_id, media));
    }
    try {
      const post = await executePublishTool(
        session.session_id,
        X_CREATE_POST_TOOL_SLUG,
        {
          ...(input.text ? { text: input.text } : {}),
          ...(mediaIds.length > 0 ? { media_media_ids: mediaIds } : {}),
        },
      );
      if (!post || typeof post.id !== "string" || !post.id) {
        throw new ComposioPublishOutcomeUnknownError();
      }
      return { externalId: post.id };
    } catch (error) {
      if (error instanceof ComposioApiError && error.httpStatus < 500)
        throw error;
      if (
        error instanceof ComposioToolError &&
        (error.providerStatus === 429 ||
          (error.providerStatus !== null && error.providerStatus < 500) ||
          (!/time.?out|timed out|temporarily|\b5\d\d\b/i.test(
            error.providerMessage ?? "",
          ) &&
            error.providerStatus === null))
      ) {
        throw error;
      }
      throw new ComposioPublishOutcomeUnknownError();
    }
  } finally {
    await deleteProjectXSession(
      session.session_id,
      "delete Project X publish session",
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
  if (response.status === 404) return;
  if (response.status === 409) {
    const account = await getProjectXConnectedAccount(input.connectedAccountId);
    if (account.status === "REVOKED") return;
  }
  await projectComposioResponse(response, "revoke Project X connection");
}

/** Permanently invalidates an unfinished OAuth link, including future redemption. */
export async function deleteProjectXConnectionIntent(input: {
  connectedAccountId: string;
}): Promise<void> {
  const response = await projectComposioFetch(
    `/api/v3.1/connected_accounts/${encodeURIComponent(input.connectedAccountId)}?revoke_on_delete=true`,
    { method: "DELETE" },
  );
  if (response.status === 404) return;
  await projectComposioResponse(
    response,
    "delete unfinished Project X connection",
  );
}
