import {
  forbidden,
  serviceUnavailable,
  tooManyRequests,
} from "@/helpers/error";

const CREATE_CONVERSATION_TIMEOUT_MS = 25_000;

const COWORKER_PROVIDER_CONFIG_ERROR_CODES = new Set([
  "billing_required",
  "insufficient_quota",
  "invalid_api_key",
  "account_deactivated",
]);

export const COWORKER_CHAT_UNAVAILABLE_MESSAGE =
  "This AI coworker is temporarily unavailable. Please try again later or choose another coworker.";

export const COWORKER_CHAT_BILLING_MESSAGE =
  "This AI coworker cannot accept messages right now because its provider account needs billing setup.";

export interface CreateCoworkerConversationOptions {
  responsesApiBaseUrl: string;
  sokosumiUserId: string;
  sokosumiOrganizationId: string | null;
  coworkerSlug: string;
  sokosumiConversationId: string;
}

export class CoworkerConversationError extends Error {
  readonly upstreamStatus: number;
  readonly upstreamCode?: string;

  constructor(message: string, upstreamStatus: number, upstreamCode?: string) {
    super(message);
    this.name = "CoworkerConversationError";
    this.upstreamStatus = upstreamStatus;
    this.upstreamCode = upstreamCode;
  }
}

function parseOpenAiErrorBody(errorText: string): {
  code?: string;
  message?: string;
} {
  try {
    const parsed = JSON.parse(errorText) as Record<string, unknown>;
    const errorObj = parsed.error;
    if (errorObj && typeof errorObj === "object") {
      const nested = errorObj as Record<string, unknown>;
      return {
        code: typeof nested.code === "string" ? nested.code : undefined,
        message:
          typeof nested.message === "string" ? nested.message : undefined,
      };
    }
  } catch {
    // Non-JSON error bodies are handled below.
  }

  if (errorText.includes("billing_required")) {
    return { code: "billing_required" };
  }

  return {};
}

function isCoworkerProviderConfigError(
  code: string | undefined,
  upstreamStatus: number,
): boolean {
  if (code && COWORKER_PROVIDER_CONFIG_ERROR_CODES.has(code)) {
    return true;
  }

  return upstreamStatus === 401 || upstreamStatus === 403;
}

function userMessageForCoworkerProviderError(code?: string): string {
  if (code === "billing_required" || code === "insufficient_quota") {
    return COWORKER_CHAT_BILLING_MESSAGE;
  }

  return COWORKER_CHAT_UNAVAILABLE_MESSAGE;
}

export function throwCoworkerRemoteConversationHttpError(
  error: unknown,
): never {
  if (error instanceof CoworkerConversationError) {
    const { upstreamStatus, upstreamCode } = error;

    if (isCoworkerProviderConfigError(upstreamCode, upstreamStatus)) {
      throw forbidden(userMessageForCoworkerProviderError(upstreamCode));
    }

    if (upstreamStatus === 429) {
      throw tooManyRequests(
        "This AI coworker is receiving too many requests. Please try again shortly.",
      );
    }

    if (upstreamStatus >= 500) {
      throw serviceUnavailable(
        "Coworker chat is temporarily unavailable. Please try again shortly.",
        {
          kind: "coworker-upstream-unavailable",
          reportToSentry: false,
        },
      );
    }

    throw forbidden(COWORKER_CHAT_UNAVAILABLE_MESSAGE);
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    throw serviceUnavailable(
      "Coworker chat timed out while starting a conversation. Please try again shortly.",
    );
  }

  throw serviceUnavailable(
    "Coworker chat could not create or resolve a remote conversation. Please try again shortly.",
  );
}

export async function createCoworkerConversation(
  options: CreateCoworkerConversationOptions,
): Promise<{ id: string }> {
  const baseUrl = options.responsesApiBaseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Responses API base URL is required");
  }
  if (!options.coworkerSlug?.trim()) {
    throw new Error("Coworker slug is required");
  }

  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/conversations`;
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sokosumi-User-Id": options.sokosumiUserId,
    "X-Coworker-Slug": options.coworkerSlug,
  };
  if (options.sokosumiOrganizationId) {
    requestHeaders["X-Sokosumi-Organization-Id"] =
      options.sokosumiOrganizationId;
  }

  const metadata: Record<string, string> = {
    sokosumi_user_id: options.sokosumiUserId,
    coworker_slug: options.coworkerSlug,
    sokosumi_conversation_id: options.sokosumiConversationId,
  };
  if (options.sokosumiOrganizationId) {
    metadata.sokosumi_organization_id = options.sokosumiOrganizationId;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ metadata }),
      signal: AbortSignal.timeout(CREATE_CONVERSATION_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw error;
    }
    throw new CoworkerConversationError(
      "Conversations API request failed",
      503,
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    const { code } = parseOpenAiErrorBody(errorText);
    throw new CoworkerConversationError(
      "Conversations API request failed",
      response.status,
      code,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CoworkerConversationError(
      "Conversations API returned invalid JSON",
      502,
    );
  }

  const bodyObj = body as Record<string, unknown>;
  const data = bodyObj?.data ?? bodyObj;
  const inner = (data as Record<string, unknown>) ?? {};
  const id =
    typeof inner?.id === "string"
      ? inner.id
      : typeof bodyObj?.id === "string"
        ? bodyObj.id
        : null;

  if (!id) {
    throw new CoworkerConversationError(
      "Conversations API returned no conversation id",
      502,
    );
  }

  return { id };
}
