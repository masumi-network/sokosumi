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
  constructor(providerLabel: string) {
    super(
      `The publishing result could not be confirmed. Check ${providerLabel} before retrying to avoid a duplicate post.`,
    );
    this.name = "ComposioPublishOutcomeUnknownError";
  }
}

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

/**
 * Creates a restricted tool-router session pinned to one connected account
 * with only the given tools enabled. The caller deletes the session.
 */
export async function createSocialPostToolSession(input: {
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
export async function executeSocialPostTool(input: {
  sessionId: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  context: string;
  refused: string;
  timeoutMs?: number;
  signal?: AbortSignal;
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
  const result = await projectComposioResponse<{
    data?: unknown;
    error?: unknown;
    successful?: boolean;
  }>(response, input.context);
  const toolResult = record(result.data);
  const providerResult = record(toolResult?.data) ?? toolResult;
  const toolError = result.error ?? toolResult?.error;
  if (toolError || result.successful === false) {
    throw new ComposioToolError({
      message: input.refused,
      providerMessage: toolErrorMessage(toolError),
      providerStatus: toolErrorStatus(toolError),
    });
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
