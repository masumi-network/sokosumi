import type { CmoChatWorkItem } from "@sokosumi/core-client";

/** Something Cuso made, or is making, in the chat. */
export type ChatWork = CmoChatWorkItem;

/** What each kind is called to the owner. */
export const CHAT_WORK_NOUN: Record<ChatWork["kind"], string> = {
  image: "picture",
  video: "video",
  audio: "voice-over",
};

/** How long each kind takes, said once while it is being made. */
export const CHAT_WORK_WAIT: Record<ChatWork["kind"], string> = {
  image: "About a minute.",
  video: "A few minutes.",
  audio: "A few seconds.",
};
