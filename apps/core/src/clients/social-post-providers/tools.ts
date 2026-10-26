import { createHash } from "node:crypto";
import { ssrfSafeFetch } from "@sokosumi/net";

import {
  ComposioApiError,
  projectComposioFetch,
  projectComposioResponse,
  projectResponseError,
  record,
} from "@/clients/composio.client";
import type { SocialPostMediaBytes } from "@/clients/social-post-providers/types";

// Long enough for a Google Ads failure, whose per-error message comes after
// several hundred characters of envelope. User-facing texts cut it shorter.
const TOOL_ERROR_MESSAGE_LIMIT = 2000;
const X_PROBLEM_TITLES = new Set([
  "forbidden",
  "unauthorized",
  "client forbidden",
  "client not enrolled",
  "invalid request",
  "bad request",
  "not found error",
  "resource not found",
  "unsupported authentication",
  "too many requests",
  "rate limit exceeded",
  "usage cap exceeded",
  "usagecapexceeded",
  "authentication error",
  "authorization error",
]);

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
  readonly providerTitle: string | null;
  readonly providerType: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(input: {
    message: string;
    providerMessage?: string | null;
    providerStatus?: number | null;
    providerTitle?: string | null;
    providerType?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(input.message);
    this.name = "ComposioToolError";
    this.providerMessage = input.providerMessage
      ? sanitizeProviderMessage(input.providerMessage)
      : null;
    this.providerStatus = input.providerStatus ?? null;
    // Only standard problem names/URIs may reach logs; arbitrary titles can contain personal data.
    this.providerTitle =
      input.providerTitle &&
      X_PROBLEM_TITLES.has(input.providerTitle.toLowerCase())
        ? input.providerTitle
        : null;
    this.providerType =
      input.providerType &&
      /^(?:about:blank|https:\/\/api\.(?:x|twitter)\.com\/2\/problems\/(?:invalid-request|resource-not-found|not-authorized-for-resource|client-forbidden|client-not-enrolled|usage-capped|rate-limit-exceeded|unsupported-authentication))$/.test(
        input.providerType,
      )
        ? input.providerType
        : null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

/** The create-post request may have succeeded; repeating it could publish twice. */
export class ComposioPublishOutcomeUnknownError extends Error {
  constructor(providerLabel: string) {
    super(
      `The publishing result could not be confirmed. Check ${providerLabel} before retrying to avoid a duplicate post.`,
    );
    this.name = "ComposioPublishOutcomeUnknownError";
  }
}

/** Inspect only known envelope fields; raw responses are never kept on the error. */
function composioToolFailure(
  message: string,
  payload: unknown,
  status?: number,
  responseHeaders?: Headers,
): ComposioToolError {
  const details: Record<string, unknown>[] = [];
  const messages: string[] = [];
  function visit(value: unknown, depth = 0) {
    if (depth > 5) return;
    const item = record(value);
    if (!item) {
      if (typeof value === "string") messages.push(value);
      return;
    }
    details.push(item);
    for (const key of ["detail", "message", "title", "type", "code"])
      if (typeof item[key] === "string") messages.push(item[key]);
    for (const key of ["error", "data", "response", "body"])
      if (item[key] !== undefined) visit(item[key], depth + 1);
    if (Array.isArray(item.errors)) visit(item.errors[0], depth + 1);
  }
  visit(payload);
  const providerStatus = [...details]
    .reverse()
    .flatMap((item) => [
      item.status,
      item.status_code,
      item.statusCode,
      item.code,
    ])
    .map(Number)
    .find((value) => Number.isInteger(value) && value >= 400 && value <= 599);
  const title = [...details]
    .reverse()
    .find((item) => typeof item.title === "string")?.title;
  const type = [...details]
    .reverse()
    .find((item) => typeof item.type === "string")?.type;
  const headers = new Headers(responseHeaders);
  // Composio can return upstream headers inside the provider envelope.
  for (const item of details) {
    for (const [key, value] of Object.entries(record(item.headers) ?? {}))
      if (
        /^(retry-after|x-rate-limit-reset)$/i.test(key) &&
        (typeof value === "string" || typeof value === "number") &&
        !/[\r\n]/.test(String(value))
      )
        headers.set(key, String(value));
  }
  const retry = headers.get("retry-after");
  const reset = headers.get("x-rate-limit-reset");
  const delay = retry
    ? /^\d+$/.test(retry)
      ? Number(retry)
      : (Date.parse(retry) - Date.now()) / 1000
    : reset
      ? Number(reset) - Date.now() / 1000
      : Number.NaN;
  const messageStatus = messages
    .join(" ")
    .match(
      /\b(?:HTTP(?: error)?[ :]*([45]\d{2})|([45]\d{2}) (?:Client|Server) Error)/i,
    );
  return new ComposioToolError({
    message,
    providerMessage: messages.join(" ") || null,
    providerStatus:
      providerStatus ??
      (messageStatus
        ? Number(messageStatus[1] ?? messageStatus[2])
        : (status ?? null)),
    providerTitle: typeof title === "string" ? title : null,
    providerType: typeof type === "string" ? type : null,
    retryAfterSeconds: Number.isSafeInteger(Math.ceil(delay))
      ? Math.max(0, Math.ceil(delay))
      : null,
  });
}

/**
 * Creates a restricted tool-router session pinned to one connected account
 * with only the given tools enabled. The caller deletes the session.
 */
export async function createComposioToolSession(input: {
  toolkitSlug: string;
  connectedAccountId: string;
  executorUserId: string;
  toolSlugs: readonly string[];
  context: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await projectComposioFetch("/api/v3.1/tool_router/session", {
    method: "POST",
    signal: input.signal,
    jsonBody: {
      user_id: input.executorUserId,
      toolkits: { enable: [input.toolkitSlug] },
      connected_accounts: {
        [input.toolkitSlug]: [input.connectedAccountId],
      },
      manage_connections: { enable: false, enable_connection_removal: false },
      tools: { [input.toolkitSlug]: { enable: [...input.toolSlugs] } },
      workbench: { enable: false, enable_proxy_execution: false },
      search: { enable: false },
      execute: { enable_multi_execute: false },
    },
  });
  const session = await projectComposioResponse<{ session_id?: string }>(
    response,
    input.context,
  );
  if (!session.session_id) projectResponseError(response, input.context);
  return session.session_id;
}

/**
 * Executes one tool in a restricted Social post session and returns the provider payload with
 * Composio's envelope layers stripped. A refused or unsuccessful execution is
 * raised as a {@link ComposioToolError}.
 */
export async function executeComposioTool(input: {
  sessionId: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  context: string;
  refused: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Research reads need X's data/includes/meta envelope, including single-user lookups. */
  preserveEnvelope?: boolean;
}): Promise<Record<string, unknown> | null> {
  const response = await projectComposioFetch(
    `/api/v3.1/tool_router/session/${encodeURIComponent(input.sessionId)}/execute`,
    {
      method: "POST",
      jsonBody: { tool_slug: input.toolSlug, arguments: input.arguments },
      timeoutMs: input.timeoutMs ?? 15_000,
      signal: input.signal,
    },
  );
  if (input.preserveEnvelope && !response.ok) {
    const failure = composioToolFailure(
      input.refused,
      await response.text(),
      response.status,
      response.headers,
    );
    throw failure;
  }
  const result = await projectComposioResponse<{
    data?: unknown;
    error?: unknown;
    successful?: boolean;
  }>(response, input.context);
  const toolResult = record(result.data);
  const providerResult = record(toolResult?.data) ?? toolResult;
  const toolError = result.error || toolResult?.error;
  if (
    toolError ||
    result.successful === false ||
    toolResult?.successful === false
  ) {
    throw composioToolFailure(
      input.refused,
      result,
      undefined,
      response.headers,
    );
  }
  if (input.preserveEnvelope) {
    const payload =
      toolResult &&
      (Array.isArray(toolResult.data) ||
        record(toolResult.data)?.id !== undefined ||
        toolResult.meta !== undefined ||
        toolResult.includes !== undefined)
        ? toolResult
        : providerResult;
    if (
      payload?.error ||
      payload?.successful === false ||
      (Array.isArray(payload?.errors) &&
        payload.errors.length &&
        !(Array.isArray(payload.data)
          ? payload.data.length > 0
          : payload.data)) ||
      [toolResult, providerResult].some((value) =>
        [value?.status, value?.status_code, value?.statusCode].some(
          (status) => Number(status) >= 400,
        ),
      ) ||
      (!payload?.data &&
        typeof payload?.title === "string" &&
        typeof payload.type === "string")
    )
      throw composioToolFailure(
        input.refused,
        result,
        undefined,
        response.headers,
      );
    return payload;
  }
  return record(providerResult?.data) ?? providerResult;
}

/**
 * Wrap create-post transport failures: the post may exist even without a
 * response, so the caller must settle an unknown outcome instead of retrying.
 */
export async function guardSocialCreateOutcome<T>(
  providerLabel: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
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
    throw new ComposioPublishOutcomeUnknownError(providerLabel);
  }
}

/**
 * Stage validated bytes as FileUploadable, not a session path. The SDK's public
 * files.upload cannot accept cancellation; use its presign protocol here.
 * https://docs.composio.dev/reference/api-reference/files/postFilesUploadRequest
 */
export async function stageSocialPublishFile(input: {
  toolkitSlug: string;
  toolSlug: string;
  file: SocialPostMediaBytes;
  signal?: AbortSignal;
}): Promise<string> {
  const name = input.file.name ?? "attachment";
  const stagingResponse = await projectComposioFetch(
    "/api/v3.1/files/upload/request",
    {
      method: "POST",
      signal: input.signal,
      jsonBody: {
        toolkit_slug: input.toolkitSlug,
        tool_slug: input.toolSlug,
        filename: name,
        mimetype: input.file.mimeType,
        md5: createHash("md5").update(input.file.bytes).digest("hex"),
      },
    },
  );
  const staging = await projectComposioResponse<{
    key?: string;
    new_presigned_url?: string;
  }>(stagingResponse, "stage media");
  if (!staging.key || !staging.new_presigned_url)
    projectResponseError(stagingResponse, "stage media");
  input.signal?.throwIfAborted();
  const uploaded = await ssrfSafeFetch(staging.new_presigned_url, {
    method: "PUT",
    headers: { "Content-Type": input.file.mimeType },
    body: input.file.bytes,
    maxResponseBytes: 64 * 1024,
    signal: input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  if (!uploaded.ok)
    throw new ComposioApiError(
      uploaded.status,
      undefined,
      "Could not stage media",
    );
  return staging.key;
}
