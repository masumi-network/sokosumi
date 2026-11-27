import { createContext, useSyncExternalStore } from "react";
import type { LiveSokoBotFields } from "@/hooks/effects/use-live-soko-bot-poll";

/**
 * Session flag: Personal Assistant chrome was shown for this account (beta).
 * Instant `/chat` loading cannot read session/email; soft-nav back paints the
 * same PA row + separator when this is true so RSC does not insert a jump
 * (SOK-903).
 */

let personalAssistantChromeVisible = false;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function publishPersonalAssistantChromeVisible(visible: boolean): void {
  if (personalAssistantChromeVisible === visible) {
    return;
  }
  personalAssistantChromeVisible = visible;
  notifyListeners();
}

export function clearPersonalAssistantChromeVisible(): void {
  publishPersonalAssistantChromeVisible(false);
}

export function subscribePersonalAssistantChromeVisible(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getPersonalAssistantChromeVisible(): boolean {
  return personalAssistantChromeVisible;
}

/**
 * Your Soko Bot as its sidebar row last polled it, so the chat list's Direct
 * with it shows the same status dot and words as that row instead of an
 * always-online dot.
 */
export interface LiveSokoBotStatus extends LiveSokoBotFields {
  id: string;
}

const liveSokoBots = new Map<symbol, LiveSokoBotStatus>();
let liveSokoBot: LiveSokoBotStatus | null = null;

function isSameLiveSokoBot(
  a: LiveSokoBotStatus | null,
  b: LiveSokoBotStatus | null,
): boolean {
  return (
    a?.id === b?.id &&
    a?.status === b?.status &&
    a?.lastActivityAt?.getTime() === b?.lastActivityAt?.getTime()
  );
}

function syncLiveSokoBot(): void {
  let next: LiveSokoBotStatus | null = null;
  for (const bot of liveSokoBots.values()) {
    next = bot;
  }
  if (isSameLiveSokoBot(liveSokoBot, next)) {
    return;
  }
  liveSokoBot = next;
  notifyListeners();
}

export function publishLiveSokoBot(bot: LiveSokoBotStatus): () => void {
  const token = Symbol();
  liveSokoBots.set(token, bot);
  syncLiveSokoBot();
  return () => {
    if (!liveSokoBots.delete(token)) {
      return;
    }
    syncLiveSokoBot();
  };
}

export function getLiveSokoBot(): LiveSokoBotStatus | null {
  return liveSokoBot;
}

export function useLiveSokoBotStatus(): LiveSokoBotStatus | null {
  return useSyncExternalStore(
    subscribePersonalAssistantChromeVisible,
    getLiveSokoBot,
    () => null,
  );
}

/**
 * Your Soko Bot whose Direct the sidebar's Direct messages list shows as the
 * bot's one row: status under the name, the team's Soko Bots at its end. The
 * bot row below the list stands down, still polling, so the bot is listed
 * once, from the server's HTML on. Null where no listed Direct is with your
 * own bot.
 */
export const SokoBotDirectRowContext = createContext<string | null>(null);
