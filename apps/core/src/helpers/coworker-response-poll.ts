export const DEFAULT_POLL_MAX_ATTEMPTS = 5;
export const DEFAULT_POLL_BASE_DELAY_MS = 500;
export const DEFAULT_POLL_MAX_DELAY_MS = 5_000;

export type CoworkerResponsePollStatus =
  | { status: "in_progress"; responseId: string }
  | { status: "completed"; responseId: string }
  | { status: "failed"; responseId: string }
  | { status: "cancelled"; responseId: string }
  | { status: "error"; responseId: string; cause: unknown };

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

async function retrieveCoworkerResponseStatus(
  params: PollCoworkerResponseStatusParams,
): Promise<CoworkerResponsePollStatus> {
  const fetchFn = params.fetchFn ?? fetch;
  const base = params.responsesApiBaseUrl.replace(/\/$/, "");
  const url = `${base}/responses/${encodeURIComponent(params.responseId)}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: buildCoworkerRetrieveHeaders({
        userId: params.userId,
        organizationId: params.organizationId,
        coworkerSlug: params.coworkerSlug,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      status: "error",
      responseId: params.responseId,
      cause: error,
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      responseId: params.responseId,
      cause: new Error(`Coworker retrieve returned HTTP ${response.status}`),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return {
      status: "error",
      responseId: params.responseId,
      cause: error,
    };
  }

  const parsed = parseCoworkerResponseStatus(params.responseId, payload);
  if (parsed) {
    return parsed;
  }

  return {
    status: "error",
    responseId: params.responseId,
    cause: new Error("Coworker retrieve returned an unrecognized status"),
  };
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
