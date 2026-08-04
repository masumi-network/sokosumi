export type OpenRouterWebSearchParameters = Record<string, unknown>;

export interface SokosumiProviderCallOptions {
  mode: "openrouter" | "coworker";
  coworkerBaseUrl?: string | null;
  coworkerSlug?: string | null;
  sokosumiUserId?: string | null;
  sokosumiOrganizationId?: string | null;
  previousResponseId?: string | null;
  providerConversationId?: string | null;
  imageGenerationModel?: string | null;
  webSearchEnabled?: boolean;
  webSearchParameters?: OpenRouterWebSearchParameters | null;
  onResponseStarted?: (responseId: string) => void | Promise<void>;
  onResponseCompleted?: (responseId: string) => void | Promise<void>;
  onInvalidPreviousResponseId?: () => void | Promise<void>;
  onInvalidProviderConversationId?: () => void | Promise<void>;
  /**
   * SSRF guard for the coworker Responses endpoint, injected by the caller.
   *
   * `coworkerBaseUrl` is vendor-supplied data, so every request built from it
   * must be checked against private/loopback/link-local/metadata addresses
   * before the socket opens. The check lives with the caller (which owns the
   * DNS-resolving implementation in `@sokosumi/net`) rather than here, so this
   * package stays dependency-free — but a coworker-mode call without a guard
   * is rejected rather than sent unchecked.
   */
  assertUrlAllowed?: (url: string) => void | Promise<void>;
}

export interface CreateSokosumiOptions {
  openRouterApiKey?: string;
  openRouterHttpReferer?: string;
  openRouterAppTitle?: string;
  openRouterMaxOutputTokens?: number;
}
