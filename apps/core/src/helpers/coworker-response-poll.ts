import { ssrfSafeFetch } from "@sokosumi/net";

const MAX_COWORKER_RETRIEVE_RESPONSE_BYTES = 16 * 1024 * 1024;

const DEFAULT_POLL_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_BASE_DELAY_MS = 500;
const DEFAULT_POLL_MAX_DELAY_MS = 5_000;

export type CoworkerResponsePollStatus =
  | { status: "in_progress"; responseId: string }
  | { status: "completed"; responseId: string }
  | { status: "failed"; responseId: string }
  | { status: "cancelled"; responseId: string }
  | {
      status: "error";
      responseId: string;
      cause: unknown;
      httpStatus?: number;
    };

export interface PollCoworkerResponseStatusParams {
  responsesApiBaseUrl: string;
  responseId: string;
  userId: string;
  organizationId: string | null;
  coworkerSlug: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchFn?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildCoworkerRetrieveHeaders(params: {
  userId: string;
  organizationId: string | null;
  coworkerSlug: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept-Encoding": "identity",
    "X-Sokosumi-User-Id": params.userId,
    "X-Coworker-Slug": params.coworkerSlug,
  };
  if (params.organizationId) {
    headers["X-Sokosumi-Organization-Id"] = params.organizationId;
  }
  return headers;
}

function parseCoworkerResponseStatus(
  responseId: string,
  payload: unknown,
): CoworkerResponsePollStatus | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const status = (payload as Record<string, unknown>).status;
  if (typeof status !== "string") {
    return null;
  }

  switch (status) {
    case "in_progress":
    case "queued":
      return { status: "in_progress", responseId };
    case "completed":
      return { status: "completed", responseId };
    case "failed":
      return { status: "failed", responseId };
    case "cancelled":
    case "canceled":
      return { status: "cancelled", responseId };
    default:
      return null;
  }
}

/** Final answer text of a Responses API payload: `output_text`, else its assistant message parts. */
export function coworkerResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }
  const output = Array.isArray(record.output) ? record.output : [];
  const text = output
    .flatMap((item) => {
      const message = item as Record<string, unknown> | null;
      if (message?.type !== "message" || !Array.isArray(message.content)) {
        return [];
      }
      return message.content.map((part) => {
        const content = part as Record<string, unknown> | null;
        return content?.type === "output_text" &&
          typeof content.text === "string"
          ? content.text
          : "";
      });
    })
    .join("")
    .trim();
  return text || null;
}

/** One retrieve of a coworker response: its status and, when finished, its text. */
export async function retrieveCoworkerResponse(
  params: PollCoworkerResponseStatusParams,
): Promise<{ result: CoworkerResponsePollStatus; text: string | null }> {
  const base = params.responsesApiBaseUrl.replace(/\/$/, "");
  const url = `${base}/responses/${encodeURIComponent(params.responseId)}`;
  const failed = (cause: unknown) => ({
    result: { status: "error" as const, responseId: params.responseId, cause },
    text: null,
  });

  let response: Response;
  try {
    const init = {
      method: "GET",
      headers: buildCoworkerRetrieveHeaders({
        userId: params.userId,
        organizationId: params.organizationId,
        coworkerSlug: params.coworkerSlug,
      }),
      signal: AbortSignal.timeout(15_000),
      maxResponseBytes: MAX_COWORKER_RETRIEVE_RESPONSE_BYTES,
    };
    response = params.fetchFn
      ? await params.fetchFn(url, init)
      : await ssrfSafeFetch(url, init);
  } catch (error) {
    return failed(error);
  }

  if (!response.ok) {
    return {
      result: {
        status: "error",
        responseId: params.responseId,
        cause: new Error(`Coworker retrieve returned HTTP ${response.status}`),
        httpStatus: response.status,
      },
      text: null,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return failed(error);
  }

  const parsed = parseCoworkerResponseStatus(params.responseId, payload);
  if (!parsed) {
    return failed(
      new Error("Coworker retrieve returned an unrecognized status"),
    );
  }
  return { result: parsed, text: coworkerResponseText(payload) };
}

async function retrieveCoworkerResponseStatus(
  params: PollCoworkerResponseStatusParams,
): Promise<CoworkerResponsePollStatus> {
  return (await retrieveCoworkerResponse(params)).result;
}

export async function pollCoworkerResponseStatus(
  params: PollCoworkerResponseStatusParams,
): Promise<CoworkerResponsePollStatus> {
  const maxAttempts = params.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
  const baseDelayMs = params.baseDelayMs ?? DEFAULT_POLL_BASE_DELAY_MS;
  const maxDelayMs = params.maxDelayMs ?? DEFAULT_POLL_MAX_DELAY_MS;

  let lastResult: CoworkerResponsePollStatus | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }

    const result = await retrieveCoworkerResponseStatus(params);
    lastResult = result;

    if (result.status === "error") {
      return result;
    }

    if (result.status !== "in_progress") {
      return result;
    }
  }

  return (
    lastResult ?? {
      status: "error",
      responseId: params.responseId,
      cause: new Error("Coworker response poll exhausted attempts"),
    }
  );
}
