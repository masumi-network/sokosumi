import { useSyncExternalStore } from "react";

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
 * Your Soko Bot's id while it is in error (its last reply failed), from the
 * sidebar row's poll, so the chat list's Direct with it says the same thing
 * as that row instead of an always-online dot.
 */
const failedSokoBotIds = new Map<symbol, string>();
let failedSokoBotId: string | null = null;

function syncFailedSokoBotId(): void {
  let next: string | null = null;
  for (const id of failedSokoBotIds.values()) {
    next = id;
  }
  if (failedSokoBotId === next) {
    return;
  }
  failedSokoBotId = next;
  notifyListeners();
}

export function publishFailedSokoBotId(id: string): () => void {
  const token = Symbol();
  failedSokoBotIds.set(token, id);
  syncFailedSokoBotId();
  return () => {
    if (!failedSokoBotIds.delete(token)) {
      return;
    }
    syncFailedSokoBotId();
  };
}

export function getFailedSokoBotId(): string | null {
  return failedSokoBotId;
}

export function useFailedSokoBotId(): string | null {
  return useSyncExternalStore(
    subscribePersonalAssistantChromeVisible,
    getFailedSokoBotId,
    () => null,
  );
}
