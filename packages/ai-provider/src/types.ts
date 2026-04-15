export interface SokosumiProviderCallOptions {
  mode: "openrouter" | "coworker";
  coworkerBaseUrl?: string | null;
  coworkerSlug?: string | null;
  sokosumiUserId?: string | null;
  sokosumiOrganizationId?: string | null;
  previousResponseId?: string | null;
  providerConversationId?: string | null;
  onResponseStarted?: (responseId: string) => void;
  onResponseCompleted?: (responseId: string) => void | Promise<void>;
  onInvalidPreviousResponseId?: () => void | Promise<void>;
  onInvalidProviderConversationId?: () => void | Promise<void>;
}

export interface CreateSokosumiOptions {
  openRouterApiKey?: string;
  openRouterHttpReferer?: string;
  openRouterAppTitle?: string;
  openRouterMaxOutputTokens?: number;
}
