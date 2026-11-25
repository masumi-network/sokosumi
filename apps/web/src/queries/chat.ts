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

function chatKey<const TRest extends readonly unknown[]>(
  scope: ChatQueryScopeInput,
  ...rest: TRest
) {
  const normalized: ChatQueryScope = {
    userId: scope.userId ?? null,
    workspaceId: scope.workspaceId ?? null,
  };
  return buildScopedQueryKey(normalized, [CHAT_QUERY_ROOT, ...rest] as const);
}

/**
 * Matches any normalized `ChatQueryScope` at index 0 via TanStack Query's
 * `partialMatchKey(scope, {}) === true`, without accumulating per-scope entries.
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
  roster: (scope: ChatQueryScopeInput, roomId: string, promiseId?: number) =>
    promiseId === undefined
      ? chatKey(scope, "roster", roomId)
      : chatKey(scope, "roster", roomId, promiseId),
  transcripts: (scope: ChatQueryScopeInput) => chatKey(scope, "transcript"),
  transcript: (scope: ChatQueryScopeInput, roomId: string) =>
    chatKey(scope, "transcript", roomId),
  noRoomTranscript: () => chatKey({}, "transcript", "no-room"),
  anyTranscript: () => anyChatScopeKey("transcript"),
  elsewhere: (scope: ChatQueryScopeInput) => chatKey(scope, "elsewhere"),
  anyElsewhere: () => anyChatScopeKey("elsewhere"),
  threads: (scope: ChatQueryScopeInput, roomId: string, visitId?: number) =>
    visitId === undefined
      ? chatKey(scope, "threads", roomId)
      : chatKey(scope, "threads", roomId, visitId),
  unreadThreads: (fingerprint: string) =>
    chatKey({}, "unread-threads", fingerprint),
  earlierThreads: (fingerprint: string) =>
    chatKey({}, "earlier-threads", fingerprint),
  openAtUnread: (roomId: string | null | undefined, visit: number) =>
    chatKey({}, "open-at-unread", roomId ?? null, visit),
  catchUpSummary: () => chatKey({}, "catch-up", "summary"),
  catchUpFirstSteps: (scope: ChatQueryScopeInput) =>
    chatKey(scope, "catch-up", "first-steps"),
  anyCatchUpFirstSteps: () => anyChatScopeKey("catch-up", "first-steps"),
  roomSummary: (roomId: string) => chatKey({}, "room-summary", roomId),
  roomCatchUp: (roomId: string) => chatKey({}, "room-catch-up", roomId),
  roomDecisions: (roomId: string) => chatKey({}, "room-decisions", roomId),
  /** The Feed's pages. Per reader and workspace, as Core reads it. */
  feedPages: (scope: ChatQueryScopeInput) => chatKey(scope, "feed", "pages"),
  /** The Feed's unread count, read with one item for the sidebar row. */
  feedUnread: (scope: ChatQueryScopeInput) => chatKey(scope, "feed", "unread"),
  stickers: (userId: string) => chatKey({ userId }, "stickers"),
  skills: (query: string) => chatKey({}, "skills", query),
  results: (
    scope: ChatQueryScopeInput,
    source: unknown,
    descriptorIds: readonly string[],
  ) => chatKey(scope, "results", source, descriptorIds),
  sokoBotConnectPrompt: () => chatKey({}, "soko-bot-connect-prompt"),
} as const;
