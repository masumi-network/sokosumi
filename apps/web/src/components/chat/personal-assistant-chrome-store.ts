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
