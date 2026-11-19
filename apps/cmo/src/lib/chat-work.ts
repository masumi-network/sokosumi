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

/** Where work Cuso handed on stands, in one line that names who has it. */
export function handedLine(work: ChatWork): string {
  const who = work.by ?? "A helper";
  switch (work.state) {
    case "making":
      return `${who} is working on this`;
    case "waiting":
      return `${who} needs an answer from you`;
    case "ready":
      return `${who} is done`;
    case "failed":
      return `${who} could not finish this`;
  }
}
