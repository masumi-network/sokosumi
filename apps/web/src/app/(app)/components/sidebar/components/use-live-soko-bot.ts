import {
  type LiveSokoBotFields,
  useLiveSokoBotPoll,
} from "@/hooks/effects/use-live-soko-bot-poll";
import { useLiveSokoBotPublisher } from "@/hooks/effects/use-live-soko-bot-publisher";

/**
 * Your bot as the server rendered it, kept current: its status and when it
 * was last active. The layout renders once and stays mounted across
 * navigation, so without this the row never changes.
 * Asks only while the tab is visible, and a failed ask keeps what it knows.
 */
export function useLiveSokoBot<Bot extends LiveSokoBotFields & { id: string }>(
  bot: Bot,
): Bot {
  const live = useLiveSokoBotPoll(bot);
  const current = live ? { ...bot, ...live } : bot;
  // The chat list's Direct with this bot says what this row says: from the
  // server's status until a poll answers, and kept when a poll fails.
  // Publish before paint (`useLayoutEffect`) so the Direct row updates in the
  // same frame as this row instead of lagging behind a passive effect.
  useLiveSokoBotPublisher(current);

  return current;
}
