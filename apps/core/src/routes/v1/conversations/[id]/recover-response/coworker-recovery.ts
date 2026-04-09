const GET_RESPONSE_BY_ID_TIMEOUT_MS = 25_000;
const LIST_CONVERSATION_ITEMS_TIMEOUT_MS = 25_000;

export function extractTextFromCompletedOutput(output: unknown): string {
  if (!Array.isArray(output) || output.length === 0) return "";
  const parts: string[] = [];
  for (const item of output) {
    const msg = item as { type?: string; content?: unknown[] };
    if (msg.type !== "message" || !Array.isArray(msg.content)) continue;
    for (const c of msg.content) {
      const part = c as { type?: string; text?: string };
      if (part.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}

function isFetchTimeoutOrAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

const RESPONSES_API_TERMINAL_STATUSES = new Set([
  "failed",
  "cancelled",
  "canceled",
  "expired",
]);

export type GetResponseResult =
  | { status: "completed"; id: string; output: unknown }
  | { status: "terminal"; apiStatus: string }
  | { status: "in_progress" | "not_found" };

export interface GetResponseByIdOptions {
  responsesApiBaseUrl: string;
  sokosumiUserId: string;
  sokosumiOrganizationId: string | null;
  coworkerSlug: string;
  responsesApiServiceKey?: string;
}

export async function getResponseById(
  responseId: string,
  options: GetResponseByIdOptions,
): Promise<GetResponseResult> {
  const baseUrl = options.responsesApiBaseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Responses API base URL is required");
  }
  if (!options.coworkerSlug?.trim()) {
    throw new Error("Responses API requires a coworker slug");
  }

  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/responses/${encodeURIComponent(responseId)}`;
  const requestHeaders: Record<string, string> = {
    "X-Sokosumi-User-Id": options.sokosumiUserId,
    "X-Coworker-Slug": options.coworkerSlug,
  };
  if (options.sokosumiOrganizationId) {
    requestHeaders["X-Sokosumi-Organization-Id"] =
      options.sokosumiOrganizationId;
  }
  if (options.responsesApiServiceKey) {
    requestHeaders.Authorization = `Bearer ${options.responsesApiServiceKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: requestHeaders,
      signal: AbortSignal.timeout(GET_RESPONSE_BY_ID_TIMEOUT_MS),
    });
  } catch (error) {
    if (isFetchTimeoutOrAbort(error)) {
      return { status: "in_progress" };
    }
    throw error;
  }

  if (response.status === 404 || response.status === 202) {
    return {
      status: response.status === 404 ? "not_found" : "in_progress",
    };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Responses API GET error: ${response.status} ${errorText}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (parseErr) {
    throw new Error(
      `Responses API GET invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    );
  }

  const bodyObj = body as Record<string, unknown>;
  const dataOrResponse = bodyObj?.data ?? bodyObj?.response ?? bodyObj;
  const inner = (dataOrResponse as Record<string, unknown>) ?? {};
  const status =
    (typeof bodyObj?.status === "string" ? bodyObj.status : null) ??
    (typeof inner?.status === "string" ? inner.status : null);
  const output = bodyObj?.output ?? inner?.output;
  const id =
    typeof bodyObj?.id === "string"
      ? bodyObj.id
      : typeof inner?.id === "string"
        ? inner.id
        : responseId;

  const hasOutput = output !== undefined && output !== null;

  if (hasOutput && (status === "completed" || status === "incomplete")) {
    return {
      status: "completed",
      id,
      output,
    };
  }

  if (status && RESPONSES_API_TERMINAL_STATUSES.has(status)) {
    return { status: "terminal", apiStatus: status };
  }

  if (status === "completed" && !hasOutput) {
    return { status: "terminal", apiStatus: "completed" };
  }

  if (status === "incomplete" && !hasOutput) {
    return { status: "terminal", apiStatus: "incomplete" };
  }

  return { status: "in_progress" };
}

export interface ListCoworkerConversationItemsOptions {
  responsesApiBaseUrl: string;
  sokosumiUserId: string;
  sokosumiOrganizationId: string | null;
  coworkerSlug: string;
  limit?: number;
  order?: "asc" | "desc";
}

export async function listCoworkerConversationItems(
  providerConversationId: string,
  options: ListCoworkerConversationItemsOptions,
): Promise<{ items: unknown[] }> {
  const baseUrl = options.responsesApiBaseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Responses API base URL is required");
  }
  if (!options.coworkerSlug?.trim()) {
    throw new Error("Coworker slug is required");
  }

  const base = baseUrl.replace(/\/$/, "");
  const limit = options.limit ?? 100;
  const order = options.order ?? "asc";
  const url = new URL(
    `${base}/conversations/${encodeURIComponent(providerConversationId)}/items`,
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", order);

  const requestHeaders: Record<string, string> = {
    "X-Sokosumi-User-Id": options.sokosumiUserId,
    "X-Coworker-Slug": options.coworkerSlug,
  };
  if (options.sokosumiOrganizationId) {
    requestHeaders["X-Sokosumi-Organization-Id"] =
      options.sokosumiOrganizationId;
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: requestHeaders,
    signal: AbortSignal.timeout(LIST_CONVERSATION_ITEMS_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Conversations items API error: ${response.status} ${errorText}`,
    );
  }

  const body = (await response.json()) as Record<string, unknown>;
  const items = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.items)
      ? body.items
      : [];

  return { items };
}

export function extractLatestAssistantFromConversationItems(items: unknown[]): {
  text: string;
  responseId: string | null;
} {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as Record<string, unknown>;
    if (item.role !== "assistant") continue;

    const content = item.content;
    let text = "";
    if (Array.isArray(content)) {
      for (const c of content) {
        const part = c as { type?: string; text?: string };
        if (part.type === "output_text" && typeof part.text === "string") {
          text += part.text;
        }
      }
    }

    const responseId =
      typeof item.response_id === "string"
        ? item.response_id
        : typeof item.responseId === "string"
          ? item.responseId
          : null;

    return { text, responseId };
  }

  return { text: "", responseId: null };
}
