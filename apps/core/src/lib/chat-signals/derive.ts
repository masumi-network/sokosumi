import {
  CHAT_SIGNAL_TAGS,
  CHAT_SIGNAL_THRESHOLD,
  type ChatSignalCorrection,
  type ChatSignalProbabilities,
  type ChatSignalTag,
  chatSignalNeedsReader,
  effectiveChatSignalTags,
} from "./tags";

/** A signal row as stored, with its corrections oldest first. */
export interface StoredChatSignal {
  state: string;
  probabilities: unknown;
  addressedUserIds: readonly string[];
  commitmentDueAt: Date | null;
  loopClosedAt: Date | null;
  loopTaskId: string | null;
  corrections: readonly ChatSignalCorrection[];
}

/** Reads the stored JSON, dropping anything that is not a known tag. */
export function parseChatSignalProbabilities(
  value: unknown,
): ChatSignalProbabilities {
  if (!value || typeof value !== "object") return {};
  const probabilities: ChatSignalProbabilities = {};
  for (const tag of CHAT_SIGNAL_TAGS) {
    const probability = (value as Record<string, unknown>)[tag];
    if (
      typeof probability === "number" &&
      Number.isFinite(probability) &&
      probability >= 0 &&
      probability <= 1
    ) {
      probabilities[tag] = probability;
    }
  }
  return probabilities;
}

export function storedChatSignalTags(
  signal: StoredChatSignal,
): Set<ChatSignalTag> {
  return effectiveChatSignalTags(
    parseChatSignalProbabilities(signal.probabilities),
    signal.corrections,
  );
}

/**
 * The viewer-neutral wire shape of a tagged message's signal: it rides on
 * realtime message events, which every member receives, so whether it needs
 * the viewer is derived by the client from `addressedUserIds`.
 */
export function toChatMessageSignalDto(signal: StoredChatSignal | null) {
  if (!signal || signal.state !== "tagged") return null;
  const tags = storedChatSignalTags(signal);
  return {
    tags: CHAT_SIGNAL_TAGS.filter((tag) => tags.has(tag)),
    probabilities: parseChatSignalProbabilities(signal.probabilities),
    addressedUserIds: [...signal.addressedUserIds],
    commitmentDueAt: tags.has("commitment") ? signal.commitmentDueAt : null,
    loopClosedAt: signal.loopClosedAt,
    loopTaskId: signal.loopTaskId,
    correctedTags: [
      ...new Set(signal.corrections.map((correction) => correction.tag)),
    ].filter((tag): tag is ChatSignalTag =>
      (CHAT_SIGNAL_TAGS as readonly string[]).includes(tag),
    ),
  };
}

/**
 * One bucket per message for the catch-up line, the most pressing first, so
 * "1 question for you, 2 decisions, 6 FYI" adds up to what is unread.
 */
export const CHAT_CATCH_UP_BUCKETS = [
  "needsYou",
  "escalation",
  "urgent",
  "blocker",
  "decisionMade",
  "needsDecision",
  "commitment",
  "workRequest",
  "question",
  "fyi",
  "chitChat",
] as const;

export type ChatCatchUpBucket = (typeof CHAT_CATCH_UP_BUCKETS)[number];

export function chatCatchUpBucket(
  tags: ReadonlySet<ChatSignalTag>,
  addressedUserIds: readonly string[],
  viewerId: string,
): ChatCatchUpBucket | null {
  if (chatSignalNeedsReader(tags, addressedUserIds, viewerId))
    return "needsYou";
  for (const bucket of CHAT_CATCH_UP_BUCKETS) {
    if (bucket !== "needsYou" && tags.has(bucket)) return bucket;
  }
  return null;
}

/** An unanswered question earns a nudge after this long. */
export const OPEN_QUESTION_AFTER_MS = 3 * 60 * 60 * 1000;

export type ChatOpenLoopKind = "question" | "decision" | "commitment";

/**
 * What kind of open loop a message is for the viewer, or null. A question or
 * decision asked of them that they have not answered after a few hours; a
 * commitment they made whose date has passed. A loop someone closed (a Task
 * made of it, or dismissed) is no longer open.
 */
export function chatOpenLoopKind(input: {
  signal: StoredChatSignal;
  viewerId: string;
  senderUserId: string | null;
  sentAt: Date;
  /** Whether the viewer wrote in the conversation after the message. */
  viewerRepliedAfter: boolean;
  now: Date;
}): ChatOpenLoopKind | null {
  const { signal, viewerId, now } = input;
  if (signal.state !== "tagged" || signal.loopClosedAt) return null;
  const tags = storedChatSignalTags(signal);
  if (
    input.senderUserId !== viewerId &&
    chatSignalNeedsReader(tags, signal.addressedUserIds, viewerId) &&
    !input.viewerRepliedAfter &&
    now.getTime() - input.sentAt.getTime() >= OPEN_QUESTION_AFTER_MS
  ) {
    return tags.has("needsDecision") ? "decision" : "question";
  }
  if (
    input.senderUserId === viewerId &&
    tags.has("commitment") &&
    signal.commitmentDueAt &&
    signal.commitmentDueAt.getTime() <= now.getTime()
  ) {
    return "commitment";
  }
  return null;
}

/**
 * SQL predicate: the signal aliased `alias` carries `tag`, by the same rule
 * as `effectiveChatSignalTags`: the newest correction of the tag, else Jev's
 * probability against the threshold. `tag` comes from the closed vocabulary,
 * never from input.
 */
export function sqlChatSignalHasTag(alias: string, tag: ChatSignalTag): string {
  if (!(CHAT_SIGNAL_TAGS as readonly string[]).includes(tag)) {
    throw new Error("Unknown chat signal tag");
  }
  return `COALESCE(
    (SELECT correction.applies
     FROM "chat_message_signal_correction" correction
     WHERE correction."signalId" = ${alias}.id AND correction.tag = '${tag}'
     ORDER BY correction."updatedAt" DESC
     LIMIT 1),
    COALESCE((${alias}.probabilities->>'${tag}')::float, 0) >= ${CHAT_SIGNAL_THRESHOLD}
  )`;
}
