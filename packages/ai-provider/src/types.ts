export interface SokosumiProviderCallOptions {
  /** Execution backend for this request. */
  mode: "openrouter" | "coworker";
  /** Coworker Responses API base URL (no trailing slash required). */
  coworkerBaseUrl?: string | null;
  /** Coworker agent slug (header `X-Coworker-Slug`). */
  coworkerSlug?: string | null;
  /** Authenticated Sokosumi user (header `X-Sokosumi-User-Id`). */
  sokosumiUserId?: string | null;
  /** Optional org (header `X-Sokosumi-Organization-Id`). */
  sokosumiOrganizationId?: string | null;
  /**
   * Optional chain id; not used for mandatory coworker Conversations mode (Core
   * omits it). Kept for compatibility with direct provider callers.
   */
  previousResponseId?: string | null;
  /**
   * Coworker Conversations API id (`conv_…`); required for `mode: "coworker"`,
   * sent as `conversation_id` on `POST /responses`.
   */
  providerConversationId?: string | null;
  /** Fired when the remote API exposes a response id (e.g. after `response.created`). */
  onResponseStarted?: (responseId: string) => void;
  /** Fired when the stream reports completion for a response id. */
  onResponseCompleted?: (responseId: string) => void;
  /**
   * Legacy: coworker Conversations mode does not send `previous_response_id`.
   */
  onInvalidPreviousResponseId?: () => void | Promise<void>;
  /**
   * Coworker only: invoked when the API rejects `conversation_id`; the provider
   * retries once with a full transcript (no `conversation_id` or chain id).
   */
  onInvalidProviderConversationId?: () => void | Promise<void>;
}

export interface CreateSokosumiOptions {
  /** Bearer token for OpenRouter `https://openrouter.ai/api/v1/responses` (required when using `mode: "openrouter"` per call). */
  openRouterApiKey?: string;
  /** Value for `HTTP-Referer` on OpenRouter requests. */
  openRouterHttpReferer?: string;
  /** Value for `X-Title` on OpenRouter requests. */
  openRouterAppTitle?: string;
  /** Default max output tokens for OpenRouter Responses bodies. */
  openRouterMaxOutputTokens?: number;
}
