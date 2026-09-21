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
 * The longest a landed row stays marked. A reader scroll cuts it short.
 * Long enough to still be running when a reader closes the thread panel a
 * jump opened, because the row it marks in the transcript sits behind that
 * panel.
 *
 * Keep in sync with --chat-jump-hold in globals.css, which draws the mark.
 */
export const ROOM_MESSAGE_HIGHLIGHT_MS = 4500;

/**
 * How long the mark takes to fade once a reader scroll ends the hold early.
 * Cutting it instead reads as a snap, on the marked row and on every other
 * row coming back out of the spotlight at the same moment.
 *
 * Keep in sync with --chat-jump-leave in globals.css, which draws the fade.
 */
export const ROOM_MESSAGE_HIGHLIGHT_LEAVE_MS = 320;

/**
 * What the mark says while it fades. globals.css draws the fade from this
 * value, and keeps the rest of the mark's styling on the attribute itself, so
 * the wash and the rail carry on from where the hold had them.
 */
const LEAVING = "leaving";

/**
 * The share of the hold the mark spends at full strength. After that the hold
 * is fading the mark out on its own, and starting the leave fade on top would
 * take the row back to full and drop it a second time. The tail is short, so a
 * scroll there ends the mark outright.
 *
 * Read from the last full-strength stop in the chat-jump-wash keyframes in
 * globals.css.
 */
const HOLD_FULL_STRENGTH_SHARE = 0.76;

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
  {
    element: HTMLElement;
    timer: number;
    landedAt: number;
    stopWatchingScroll: () => void;
  }
>();

/**
 * The reader's own scrolling, as input rather than as movement. A `scroll`
 * event cannot stand for it: the jump scrolls the list itself, and the
 * virtualizer writes `scrollTop` again as the rows around the landing measure
 * (`keepRowsInPlace` in `components/transcript-viewport.tsx`). Those writes
 * raise the same event the reader's scrolling does, and they carry on after
 * the mark is set, which is why that file waits `LANDING_FRAMES` for a
 * landing to settle. A wheel and a touch drag only ever come from the reader.
 *
 * Scrolling by keyboard, and moving the scrollbar itself, raise neither, so
 * those leave the mark standing until the hold ends. The hold is short, so
 * that costs the reader a moment of the spotlight rather than a stuck mark.
 */
const READER_SCROLL_EVENTS = ["wheel", "touchmove"] as const;

/**
 * Drop the mark as soon as the reader scrolls the list they landed in. The
 * mark is a landing cue, and the spotlight it casts dims every other row, so
 * neither has a job once the reader moves.
 *
 * Watched from the window in the capture phase, so this module does not have
 * to know the shape of the markup around the list. The event has to come from
 * inside the list itself: the room transcript and the open thread each hold a
 * mark of their own, and scrolling one says nothing about the other. An
 * ancestor both sit in would answer for both.
 */
function watchReaderScroll(list: Element): () => void {
  const onReaderScroll = (event: Event) => {
    if (event.target instanceof Node && list.contains(event.target)) {
      fadeOutHighlight(list);
    }
  };
  for (const type of READER_SCROLL_EVENTS) {
    window.addEventListener(type, onReaderScroll, {
      capture: true,
      passive: true,
    });
  }
  return () => {
    for (const type of READER_SCROLL_EVENTS) {
      window.removeEventListener(type, onReaderScroll, { capture: true });
    }
  };
}

function clearHighlight(list: Element): void {
  const active = activeHighlights.get(list);
  if (!active) {
    return;
  }
  window.clearTimeout(active.timer);
  active.stopWatchingScroll();
  delete active.element.dataset.searchLanded;
  activeHighlights.delete(list);
}

/**
 * End the hold the way a reader scroll should: hand the mark to the leave
 * fade, and drop it when that fade has run. The watch stops here, because the
 * mark is already on its way out and a second scroll has nothing left to end.
 */
function fadeOutHighlight(list: Element): void {
  const active = activeHighlights.get(list);
  if (!active || active.element.dataset.searchLanded === LEAVING) {
    return;
  }
  window.clearTimeout(active.timer);
  active.stopWatchingScroll();
  if (
    Date.now() - active.landedAt >=
    HOLD_FULL_STRENGTH_SHARE * ROOM_MESSAGE_HIGHLIGHT_MS
  ) {
    clearHighlight(list);
    return;
  }
  active.element.dataset.searchLanded = LEAVING;
  activeHighlights.set(list, {
    ...active,
    stopWatchingScroll: () => {},
    timer: window.setTimeout(() => {
      clearHighlight(list);
    }, ROOM_MESSAGE_HIGHLIGHT_LEAVE_MS),
  });
}

/**
 * Scroll the row into view and mark it as landed for a moment. The mark is
 * styled from `data-search-landed` in globals.css, so a React re-render inside
 * that moment cannot wipe it, as it would a class added here. A reader scroll
 * ends the moment early.
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
    landedAt: Date.now(),
    timer: window.setTimeout(() => {
      clearHighlight(list);
    }, ROOM_MESSAGE_HIGHLIGHT_MS),
    stopWatchingScroll: watchReaderScroll(list),
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
