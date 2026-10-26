/**
 * Chat signals: what Jev reads in a chat message, as probabilities.
 *
 * A tag sorts, highlights and suggests. It never hides or blocks a message,
 * so a wrong tag costs a reader a moment, not a message. The probabilities
 * are stored as Jev answered them; thresholds live here and apply on read,
 * so tuning them changes every message at once without a re-tag.
 */
export const CHAT_SIGNAL_TAGS = [
  "question",
  "needsDecision",
  "commitment",
  "blocker",
  "decisionMade",
  "fyi",
  "urgent",
  "chitChat",
  "workRequest",
  "escalation",
] as const;

export type ChatSignalTag = (typeof CHAT_SIGNAL_TAGS)[number];

/** Jev's probability per tag. A tag Jev was not asked about is missing. */
export type ChatSignalProbabilities = Partial<Record<ChatSignalTag, number>>;

/** A tag applies at or above this probability. */
export const CHAT_SIGNAL_THRESHOLD = 0.6;
/**
 * Interrupting costs attention, so a push needs Jev to be surer than a sort
 * does: the same bar mail importance uses.
 */
export const CHAT_SIGNAL_PUSH_THRESHOLD = 0.75;

/** The tags that ask something of a named reader. */
export const NEEDS_YOU_TAGS = ["question", "needsDecision"] as const;

export function isChatSignalTag(value: string): value is ChatSignalTag {
  return (CHAT_SIGNAL_TAGS as readonly string[]).includes(value);
}

/** A reader's correction of one tag on one message. */
export interface ChatSignalCorrection {
  tag: string;
  applies: boolean;
}

/**
 * The tags that apply to a message: Jev's probabilities over the threshold,
 * with readers' corrections on top. The newest correction of a tag wins, so
 * `corrections` is expected oldest first.
 */
export function effectiveChatSignalTags(
  probabilities: ChatSignalProbabilities,
  corrections: readonly ChatSignalCorrection[] = [],
  threshold = CHAT_SIGNAL_THRESHOLD,
): Set<ChatSignalTag> {
  const tags = new Set(
    CHAT_SIGNAL_TAGS.filter((tag) => (probabilities[tag] ?? 0) >= threshold),
  );
  for (const correction of corrections) {
    if (!isChatSignalTag(correction.tag)) continue;
    if (correction.applies) tags.add(correction.tag);
    else tags.delete(correction.tag);
  }
  return tags;
}

/** Whether a message asks something of this reader. */
export function chatSignalNeedsReader(
  tags: ReadonlySet<ChatSignalTag>,
  addressedUserIds: readonly string[],
  readerId: string,
): boolean {
  return (
    addressedUserIds.includes(readerId) &&
    NEEDS_YOU_TAGS.some((tag) => tags.has(tag))
  );
}

const ACKNOWLEDGEMENTS = new Set([
  "ok",
  "okay",
  "k",
  "kk",
  "yes",
  "yep",
  "yeah",
  "no",
  "nope",
  "thanks",
  "thank you",
  "thx",
  "ty",
  "cool",
  "nice",
  "great",
  "lol",
  "haha",
  "sure",
  "done",
  "got it",
  "sounds good",
  "perfect",
  "danke",
  "gracias",
]);

const MENTION_TOKEN = /@[\p{L}\p{N}._-]+(?::[\p{L}\p{N}_-]*)?/gu;
const URL = /https?:\/\/\S+/gu;

/**
 * Whether a message is too short to mean anything on its own: an
 * acknowledgement, an emoji, a lone link. Those are never sent to Jev.
 */
export function isTooShortForChatSignals(content: string): boolean {
  const text = content
    .replace(MENTION_TOKEN, " ")
    .replace(URL, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  if (ACKNOWLEDGEMENTS.has(text)) return true;
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  const words = text ? text.split(" ").length : 0;
  return letters < 8 || words < 2;
}

/** When a commitment says it will be done; Jev picks one. */
export const CHAT_SIGNAL_DUE_CHOICES = [
  "NONE",
  "TODAY",
  "TOMORROW",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
  "THIS_WEEK",
  "NEXT_WEEK",
  "THIS_MONTH",
] as const;

export type ChatSignalDueChoice = (typeof CHAT_SIGNAL_DUE_CHOICES)[number];

const WEEKDAYS: readonly ChatSignalDueChoice[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function endOfUtcDay(date: Date, addDays: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + addDays,
      23,
      59,
      59,
    ),
  );
}

/**
 * The end of the day a commitment is due, from when it was said. UTC, since
 * a chat message carries no time zone: a nudge a few hours late is fine.
 * A weekday means its next occurrence, today included ("by Friday" said on a
 * Friday means today).
 */
export function resolveChatSignalDueAt(
  choice: ChatSignalDueChoice,
  sentAt: Date,
): Date | null {
  const today = sentAt.getUTCDay();
  switch (choice) {
    case "NONE":
      return null;
    case "TODAY":
      return endOfUtcDay(sentAt, 0);
    case "TOMORROW":
      return endOfUtcDay(sentAt, 1);
    case "THIS_WEEK":
      // Friday ends the working week; said on a weekend it means today.
      return endOfUtcDay(sentAt, Math.max(0, 5 - today));
    case "NEXT_WEEK":
      return endOfUtcDay(sentAt, ((5 - today + 7) % 7) + 7);
    case "THIS_MONTH":
      return new Date(
        Date.UTC(
          sentAt.getUTCFullYear(),
          sentAt.getUTCMonth() + 1,
          0,
          23,
          59,
          59,
        ),
      );
    default: {
      const target = WEEKDAYS.indexOf(choice);
      return endOfUtcDay(sentAt, (target - today + 7) % 7);
    }
  }
}
