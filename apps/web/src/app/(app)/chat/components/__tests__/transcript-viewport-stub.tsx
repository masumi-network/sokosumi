import { Fragment, type ReactNode, type Ref, useImperativeHandle } from "react";
import { vi } from "vitest";

import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
} from "@/app/chat/chat-message-list";
import type { TranscriptViewportHandle } from "@/app/chat/components/transcript-viewport";
import { highlightListMessage } from "@/app/chat/utils/room-message-highlight";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import { transcriptRowKey } from "@/app/chat/utils/transcript-viewport-model";

/**
 * Stand-in for the room transcript viewport in RoomsClient tests: mounts every
 * row, so a test can find any message in the DOM, and records the scroll
 * calls the real viewport would turn into scrolling. Landing marks the row
 * the way the real one does once the row is mounted, which here is at once.
 *
 * Stable spies on purpose. A fresh `vi.fn()` per render cannot show which
 * room a hold was taken for, or which jump gave it back.
 *
 * Use with `vi.mock("@/app/chat/components/transcript-viewport", () =>
 * import("./transcript-viewport-stub"))`.
 */
export const transcriptViewportSpies = {
  scrollToBottom: vi.fn(),
  pinToBottomAfterOwnSend: vi.fn(),
  scrollToBottomIfPinned: vi.fn(),
  suppressStickToBottom: vi.fn(),
  releaseStickToBottomSuppress: vi.fn(),
  // Recording only. Each stub instance answers from its own list so a
  // thread-only quote fallback is reachable when both viewports are stubbed.
  scrollToMessage: vi.fn(),
};

export function TranscriptViewport({
  rows,
  renderRow,
  list = CHAT_MESSAGE_LIST_ROOM,
  ref,
}: {
  rows: readonly RoomTranscriptRenderRow[];
  renderRow: (row: RoomTranscriptRenderRow) => ReactNode;
  list?: string;
  ref: Ref<TranscriptViewportHandle>;
}) {
  useImperativeHandle(ref, () => ({
    ...transcriptViewportSpies,
    landOnMessage: (messageId) => highlightListMessage(list, messageId),
    scrollToMessage: (messageId) => {
      transcriptViewportSpies.scrollToMessage(messageId);
      return (
        document.querySelector(
          `[${CHAT_MESSAGE_LIST_ATTRIBUTE}="${list}"] [data-message-id="${CSS.escape(messageId)}"]`,
        ) != null
      );
    },
    captureAnchor: () => null,
    restoreAnchor: () => undefined,
  }));
  return (
    <>
      {rows.map((row) => (
        <Fragment key={transcriptRowKey(row)}>{renderRow(row)}</Fragment>
      ))}
    </>
  );
}
