/**
 * A structured hand-off between agents, as plain text after the natural
 * message: every agent reads it, including a Coworker that reads only text.
 * The stand-up's hand-offs and send_message's `request` both write it.
 */
export interface HandoffRequest {
  goal: string;
  background?: string | null;
  deliverable?: string | null;
  deadline?: string | null;
}

export function handoffRequestBlock(request: HandoffRequest): string {
  return [
    "Request",
    `- Goal: ${request.goal.trim()}`,
    ...(request.background?.trim()
      ? [`- Background: ${request.background.trim()}`]
      : []),
    `- What I need back: ${request.deliverable?.trim() || "your answer, with any files or links"}`,
    `- By: ${request.deadline?.trim() || "when you can"}`,
  ].join("\n");
}

export const REPLY_STATUSES = [
  "done",
  "needs_input",
  "declined",
  "working",
] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

const URL = /https?:\/\/[^\s)<>\]"']+/g;

/** Links in a reply, in order, once each. */
export function replyLinks(reply: string): string[] {
  return [
    ...new Set(
      (reply.match(URL) ?? []).map((link) => link.replace(/[.,;:!?]+$/, "")),
    ),
  ].slice(0, 10);
}
