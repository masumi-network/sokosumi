import type { CmoChatWorkItem } from "@sokosumi/core-client";

/** Something Cuso made, is making, or handed on in the chat. */
export type ChatWork = CmoChatWorkItem;

type MediaKind = "image" | "video" | "audio";

/** A picture, video or voice-over: shown as the file itself. */
export type ChatWorkMedia = ChatWork & { kind: MediaKind };

export function isMedia(work: ChatWork): work is ChatWorkMedia {
  return (
    work.kind === "image" || work.kind === "video" || work.kind === "audio"
  );
}

/** What each kind is called to the owner. */
export const CHAT_WORK_NOUN: Record<MediaKind, string> = {
  image: "picture",
  video: "video",
  audio: "voice-over",
};

/** How long each kind takes, said once while it is being made. */
export const CHAT_WORK_WAIT: Record<MediaKind, string> = {
  image: "About a minute.",
  video: "A few minutes.",
  audio: "A few seconds.",
};

/** A table as the chat shows it. */
export type ChatTable = NonNullable<ChatWork["table"]>;

/**
 * Where work stands, in one line that names who has it: a Coworker or a
 * hired Agent, Cuso himself on a background run, or the Coworker he asked.
 */
export function statusLine(work: ChatWork): string {
  const who = work.by ?? "A helper";
  if (work.kind === "run") {
    switch (work.state) {
      case "ready":
        return "Done";
      case "stopped":
        return "Stopped";
      case "failed":
        return "This did not finish";
      default:
        return "Working on this in the background";
    }
  }
  if (work.kind === "question")
    return work.state === "ready" ? `${who} answered` : `Asked ${who}`;
  switch (work.state) {
    case "making":
      return `${who} is working on this`;
    case "waiting":
      return `${who} needs an answer from you`;
    case "ready":
      return `${who} is done`;
    default:
      return `${who} could not finish this`;
  }
}

/** What a card says while its work is under way. */
export function waitingNote(work: ChatWork): string {
  if (work.kind === "question") return "I tell you here when the answer is in.";
  return "I tell you here when it is done.";
}
