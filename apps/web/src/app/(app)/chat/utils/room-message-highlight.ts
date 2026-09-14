/**
 * Landing marks for a jump: the row the reader was sent to, and the room row
 * the thread behind it hangs off.
 *
 * Beside the jumps that use it in `utils/`, rather than in
 * `components/room-helpers.ts`, which is already past the repo's file ceiling
 * and holds no other jump step.
 */

import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
} from "@/app/chat/chat-message-list";

/**
 * How long a landed row stays marked. Long enough to still be running when a
 * reader closes the thread panel a jump opened, because the row it marks in
 * the transcript sits behind that panel.
 *
 * Keep in sync with --chat-jump-hold in globals.css, which draws the mark.
 */
export const ROOM_MESSAGE_HIGHLIGHT_MS = 4500;

/**
 * One mark per message list. A thread jump marks two rows at once: the reply
 * in the panel, and the message its thread hangs off in the transcript behind
 * it. Keying by the list each row sits in lets those two stand together, while
 * a second jump into the same list still replaces the mark there. That
 * replacement is what keeps a row from staying marked for good, and keeps the
 * first jump's timer from clearing the second jump's mark early.
 */
const activeHighlights = new Map<
  Element,
  { element: HTMLElement; timer: number }
>();

function clearHighlight(list: Element): void {
  const active = activeHighlights.get(list);
  if (!active) {
    return;
  }
  window.clearTimeout(active.timer);
  delete active.element.dataset.searchLanded;
  activeHighlights.delete(list);
}

/**
 * Scroll the row into view and mark it as landed for a moment. The mark is
 * styled from `data-search-landed` in globals.css, so a React re-render inside
 * that moment cannot wipe it, as it would a class added here.
 */
function landOn(list: Element, target: HTMLElement): void {
  target.scrollIntoView({ behavior: "auto", block: "center" });
  clearHighlight(list);
  // Reading layout between the two writes, so that a second landing on the
  // row that is already marked shows. Without the recalc in between, the
  // attribute is gone and back inside one task, the wash and the rail carry on
  // from where they were, and the reader sees nothing happen. Two
  // notifications for replies in one thread land on the same parent, so this
  // is the common case rather than the odd one.
  target.getBoundingClientRect();
  target.dataset.searchLanded = "true";
  activeHighlights.set(list, {
    element: target,
    timer: window.setTimeout(() => {
      clearHighlight(list);
    }, ROOM_MESSAGE_HIGHLIGHT_MS),
  });
}

function landOnMessageIn(list: Element | null, messageId: string): boolean {
  if (!list) {
    return false;
  }
  const target = list.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!target) {
    return false;
  }
  landOn(list, target);
  return true;
}

/**
 * Land on a message in the named list. False when that list does not hold it.
 *
 * Room and thread share message ids (a thread's parent is in both), so which
 * copy a jump marks must be the list the caller named, not whichever copy
 * comes first in the document.
 */
export function highlightListMessage(list: string, messageId: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return landOnMessageIn(
    document.querySelector(`[${CHAT_MESSAGE_LIST_ATTRIBUTE}="${list}"]`),
    messageId,
  );
}

/**
 * Land on a message in the open thread. False when the thread does not hold
 * it, which is the caller's cue to load a window around it.
 */
export function highlightThreadMessage(messageId: string): boolean {
  return highlightListMessage(CHAT_MESSAGE_LIST_THREAD, messageId);
}

/**
 * Land on a message in the room transcript. False when the message is not in
 * the loaded page.
 */
export function highlightRoomTranscriptMessage(messageId: string): boolean {
  return highlightListMessage(CHAT_MESSAGE_LIST_ROOM, messageId);
}
