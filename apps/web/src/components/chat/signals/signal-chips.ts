import type {
  ChatMessageSignal,
  ChatRoomMessage,
  ChatSignalTag,
} from "@sokosumi/core-client";

/** Every tag, in the order the editor lists them. */
export const CHAT_SIGNAL_TAG_ORDER: readonly ChatSignalTag[] = [
  "question",
  "needsDecision",
  "decisionMade",
  "announcement",
  "commitment",
  "blocker",
  "urgent",
  "escalation",
  "workRequest",
  "fyi",
  "chitChat",
];

/**
 * The chips a message shows: what changes what a reader does. FYI and small
 * talk sort and summarise but never draw a chip, or every message would wear
 * one. A question or decision for the reader becomes one `needsYou` chip.
 */
export type ChatSignalChip = ChatSignalTag | "needsYou";

const CHIP_ORDER: readonly ChatSignalChip[] = [
  "needsYou",
  "escalation",
  "urgent",
  "blocker",
  "decisionMade",
  "announcement",
  "needsDecision",
  "commitment",
  "workRequest",
];

export function signalNeedsReader(
  signal: Pick<ChatMessageSignal, "tags" | "addressedUserIds">,
  readerId: string | undefined,
): boolean {
  return (
    readerId != null &&
    signal.addressedUserIds.includes(readerId) &&
    (signal.tags.includes("question") || signal.tags.includes("needsDecision"))
  );
}

export function signalChips(
  signal: Pick<ChatMessageSignal, "tags" | "addressedUserIds">,
  readerId: string | undefined,
): ChatSignalChip[] {
  const needsReader = signalNeedsReader(signal, readerId);
  return CHIP_ORDER.filter((chip) => {
    if (chip === "needsYou") return needsReader;
    // Folded into the needs-you chip when it is the reader who is asked.
    if (chip === "needsDecision" && needsReader) return false;
    return signal.tags.includes(chip);
  });
}

/** The tags a chip stands for, so removing the chip removes all of them. */
export function chipTags(
  chip: ChatSignalChip,
  signal: Pick<ChatMessageSignal, "tags">,
): ChatSignalTag[] {
  if (chip !== "needsYou") return [chip];
  return signal.tags.filter(
    (tag) => tag === "question" || tag === "needsDecision",
  );
}

/** Who wrote a message, as the room names them; empty when unknown. */
export function chatMessageSenderName(message: ChatRoomMessage): string {
  switch (message.sender.type) {
    case "user":
      return message.sender.user.name;
    case "coworker":
      return message.sender.coworker.name;
    case "sokoBot":
      return message.sender.sokoBot.name ?? "";
    default:
      return "";
  }
}
