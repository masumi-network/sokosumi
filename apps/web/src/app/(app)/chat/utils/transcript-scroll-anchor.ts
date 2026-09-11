import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
} from "@/app/chat/chat-message-list";

export interface TranscriptScrollAnchor {
  messageId: string;
  /** Distance from the scroller's top edge to the row's top edge. */
  offset: number;
}

function findTranscriptRow(
  scroller: HTMLElement,
  messageId: string,
): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(
    `[${CHAT_MESSAGE_LIST_ATTRIBUTE}="${CHAT_MESSAGE_LIST_ROOM}"] [data-message-id="${CSS.escape(messageId)}"]`,
  );
}

/**
 * Where a row sits in the viewport before rows are inserted above it.
 * Null when the row is not rendered, in which case there is nothing to hold.
 */
export function captureTranscriptScrollAnchor(
  scroller: HTMLElement,
  messageId: string,
): TranscriptScrollAnchor | null {
  const row = findTranscriptRow(scroller, messageId);
  if (!row) {
    return null;
  }
  return {
    messageId,
    offset:
      row.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
  };
}

/**
 * Put the anchored row back where it was. Done by hand rather than left to
 * `overflow-anchor`, which Safari does not implement, so a boundary load on
 * an iPhone would otherwise shove the transcript under the reader's thumb.
 */
export function restoreTranscriptScrollAnchor(
  scroller: HTMLElement,
  anchor: TranscriptScrollAnchor,
): void {
  const row = findTranscriptRow(scroller, anchor.messageId);
  if (!row) {
    return;
  }
  const offset =
    row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const drift = offset - anchor.offset;
  if (drift !== 0) {
    scroller.scrollTop += drift;
  }
}
