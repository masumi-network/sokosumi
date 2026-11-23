import { buildScopedQueryKey } from "@/queries/scoped-queries";

export const CHAT_QUERY_ROOT = "chat" as const;

export interface ChatQueryScopeInput {
  userId?: string | null;
  workspaceId?: string | null;
}

export interface ChatQueryScope {
  readonly userId: string | null;
  readonly workspaceId: string | null;
}

const ANY_CHAT_SCOPE = {} as const;

export function normalizeChatScope(
  scope: ChatQueryScopeInput = {},
): ChatQueryScope {
  return {
    userId: scope.userId ?? null,
    workspaceId: scope.workspaceId ?? null,
  };
}

function chatKey<const TRest extends readonly unknown[]>(
  scope: ChatQueryScopeInput,
  ...rest: TRest
) {
  return buildScopedQueryKey(normalizeChatScope(scope), [
    CHAT_QUERY_ROOT,
    ...rest,
  ] as const);
}

/**
 * Matches any normalized `ChatQueryScope` at index 0 via TanStack Query's
 * `partialMatchKey({}, scope) === true`, without accumulating per-scope entries.
 */
function anyChatScopeKey<const TRest extends readonly unknown[]>(
  ...rest: TRest
) {
  return [ANY_CHAT_SCOPE, CHAT_QUERY_ROOT, ...rest] as const;
}

export const chatQueryKeys = {
  prefix: (scope: ChatQueryScopeInput) => chatKey(scope),
  sidebarRooms: (scope: ChatQueryScopeInput) => chatKey(scope, "sidebar-rooms"),
  sidebarRoomCollection: (scope: ChatQueryScopeInput, collection: string) =>
    chatKey(scope, "sidebar-rooms", collection),
  roster: (scope: ChatQueryScopeInput, roomId: string) =>
    chatKey(scope, "roster", roomId),
  transcripts: (scope: ChatQueryScopeInput) => chatKey(scope, "transcript"),
  transcript: (scope: ChatQueryScopeInput, roomId: string) =>
    chatKey(scope, "transcript", roomId),
  noRoomTranscript: () => chatKey({}, "transcript", "no-room"),
  anyTranscript: () => anyChatScopeKey("transcript"),
  elsewhere: (scope: ChatQueryScopeInput) => chatKey(scope, "elsewhere"),
  anyElsewhere: () => anyChatScopeKey("elsewhere"),
  threads: (scope: ChatQueryScopeInput, roomId: string) =>
    chatKey(scope, "threads", roomId),
  unreadThreads: (scope: ChatQueryScopeInput, fingerprint: string) =>
    chatKey(scope, "unread-threads", fingerprint),
  earlierThreads: (scope: ChatQueryScopeInput, fingerprint: string) =>
    chatKey(scope, "earlier-threads", fingerprint),
  openAtUnread: (
    scope: ChatQueryScopeInput,
    roomId: string | null | undefined,
    visit: number,
  ) => chatKey(scope, "open-at-unread", roomId ?? null, visit),
  catchUpSummary: (scope: ChatQueryScopeInput) =>
    chatKey(scope, "catch-up", "summary"),
  catchUpFirstSteps: (scope: ChatQueryScopeInput) =>
    chatKey(scope, "catch-up", "first-steps"),
  anyCatchUpFirstSteps: () => anyChatScopeKey("catch-up", "first-steps"),
  roomSummary: (scope: ChatQueryScopeInput, roomId: string) =>
    chatKey(scope, "room-summary", roomId),
  roomCatchUp: (scope: ChatQueryScopeInput, roomId: string) =>
    chatKey(scope, "room-catch-up", roomId),
  roomDecisions: (scope: ChatQueryScopeInput, roomId: string) =>
    chatKey(scope, "room-decisions", roomId),
  stickers: (scope: ChatQueryScopeInput) => chatKey(scope, "stickers"),
  skills: (query: string) => chatKey({}, "skills", query),
  results: (
    scope: ChatQueryScopeInput,
    source: unknown,
    descriptorIds: readonly string[],
  ) => chatKey(scope, "results", source, descriptorIds),
  sokoBotConnectPrompt: () => chatKey({}, "soko-bot-connect-prompt"),
} as const;

export function splitChatQueryKey<const TRest extends readonly unknown[]>(
  key: readonly [ChatQueryScope, typeof CHAT_QUERY_ROOT, ...TRest],
): {
  scope: ChatQueryScope;
  queryKey: readonly [typeof CHAT_QUERY_ROOT, ...TRest];
} {
  const [scope, ...queryKey] = key;
  return { scope, queryKey };
}
