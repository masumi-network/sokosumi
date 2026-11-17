import {
  AVATAR_DONE_MS,
  type AvatarState,
  avatarStateOf,
} from "@sokosumi/soko-bot";
import { useEffect, useReducer } from "react";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

/**
 * What the console's avatar shows, from the chat state it already polls: the bot's status, its
 * latest turn, the decisions waiting on you, and a turn that finished moments ago.
 */
export function avatarStateOfChat(
  { bot, turns }: SokoBotChatState,
  now = Date.now(),
): AvatarState {
  const latest = turns[0];
  const completedAt = latest?.completedAt
    ? Date.parse(latest.completedAt)
    : NaN;
  return avatarStateOf({
    status: bot.status,
    turnStatus: latest?.status,
    pendingDecisions: bot.pendingDecisions.filter((d) => d.status === "PENDING")
      .length,
    finishedAt:
      latest?.status === "COMPLETED" && Number.isFinite(completedAt)
        ? completedAt
        : null,
    now,
  });
}

/** `avatarStateOfChat`, re-read when the celebration of a finished turn runs out. */
export function useChatAvatarState(state: SokoBotChatState): AvatarState {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const current = avatarStateOfChat(state);
  useEffect(() => {
    if (current !== "done") return;
    const timer = setTimeout(rerender, AVATAR_DONE_MS + 50);
    return () => clearTimeout(timer);
  }, [current, state]);
  return current;
}
