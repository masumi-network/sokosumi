export const CONVERSATION_PROVIDERS = {
  OPENROUTER: "openrouter",
  COWORKER: "coworker",
} as const;

export type ConversationProvider =
  (typeof CONVERSATION_PROVIDERS)[keyof typeof CONVERSATION_PROVIDERS];

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ConversationActorContext {
  userId: string;
  organizationId: string | null;
}

export interface ConversationCoworkerContext {
  id: string;
  slug: string;
  baseUrl: string;
}

export interface ConversationLifecycleHandlers {
  onResponseStarted?: (responseId: string) => void | Promise<void>;
  onResponseCompleted?: (responseId: string) => void | Promise<void>;
}

export interface ConversationStreamRequest {
  actor: ConversationActorContext;
  messages: ConversationMessage[];
  modelId: string | null;
  previousResponseId?: string | null;
  coworker?: ConversationCoworkerContext | null;
  lifecycle?: ConversationLifecycleHandlers;
}

export interface ConversationRecoverRequest {
  actor: ConversationActorContext;
  pendingResponseId: string;
  coworker: ConversationCoworkerContext;
}

export type ConversationRecoverResult =
  | { status: "completed"; id: string; output: unknown }
  | { status: "terminal"; apiStatus: string }
  | { status: "in_progress" | "not_found" };

export interface ConversationClient {
  readonly provider: ConversationProvider;
  stream(request: ConversationStreamRequest): Promise<Response>;
  recoverPendingResponse?(
    request: ConversationRecoverRequest,
  ): Promise<ConversationRecoverResult>;
}

export interface ConversationClientResolver {
  resolve(options: ResolveConversationClientOptions): ConversationClient;
}

export interface ConversationClientRegistry {
  openrouter: ConversationClient;
  coworker: ConversationClient;
}

export interface ResolveConversationClientOptions {
  preferredProvider?: ConversationProvider | null;
  conversationId?: string | null;
  coworker?: ConversationCoworkerContext | null;
}

export function resolveConversationProvider(
  options: ResolveConversationClientOptions,
): ConversationProvider {
  if (options.preferredProvider) {
    return options.preferredProvider;
  }

  const hasConversation = Boolean(options.conversationId);
  const hasCoworker = Boolean(options.coworker);
  const useCoworkerProvider = hasConversation && hasCoworker;

  return useCoworkerProvider
    ? CONVERSATION_PROVIDERS.COWORKER
    : CONVERSATION_PROVIDERS.OPENROUTER;
}

export function createConversationClientResolver(
  clients: ConversationClientRegistry,
): ConversationClientResolver {
  return {
    resolve(options) {
      const provider = resolveConversationProvider(options);

      return provider === CONVERSATION_PROVIDERS.COWORKER
        ? clients.coworker
        : clients.openrouter;
    },
  };
}
