import {
  Fragment,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { vi } from "vitest";

import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
} from "@/app/chat/chat-message-list";
import type {
  TranscriptPosition,
  TranscriptViewportHandle,
} from "@/app/chat/components/transcript-viewport";
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
  position:
    vi.fn<
      (props: {
        initialPosition?: TranscriptPosition;
        onPositionChange?: (position: TranscriptPosition) => void;
      }) => void
    >(),
  scrollToBottom: vi.fn(),
  pinToBottomAfterOwnSend: vi.fn(),
  suppressStickToBottom: vi.fn(),
  releaseStickToBottomSuppress: vi.fn(),
  // Recording only. Each stub instance answers from its own list so a
  // thread-only quote fallback is reachable when both viewports are stubbed.
  scrollToMessage: vi.fn(),
};

/**
 * Whether the reader is at the end of the transcript, which the real viewport
 * reads from the scroller. A stub that reports it opens at `openAtEnd`;
 * `report` moves it, as a scroll would. A landing reports the reader off the
 * end, as a jump to an older message does. Reset by the rooms-client harness.
 */
export const transcriptViewportEnd = {
  openAtEnd: true,
  report: (_atEnd: boolean): void => {},
};

export function TranscriptViewport({
  rows,
  initialPosition,
  onPositionChange,
  onAtEndChange,
  renderRow,
  list = CHAT_MESSAGE_LIST_ROOM,
  ref,
}: {
  initialPosition?: TranscriptPosition;
  onPositionChange?: (position: TranscriptPosition) => void;
  onAtEndChange?: (atEnd: boolean) => void;
  rows: readonly RoomTranscriptRenderRow[];
  renderRow: (row: RoomTranscriptRenderRow) => ReactNode;
  list?: string;
  ref: Ref<TranscriptViewportHandle>;
}) {
  transcriptViewportSpies.position({ initialPosition, onPositionChange });
  const atEndRef = useRef(onAtEndChange);
  atEndRef.current = onAtEndChange;
  const opensAboveEndRef = useRef(
    initialPosition != null && !initialPosition.atLiveEdge,
  );
  useEffect(() => {
    if (!atEndRef.current) return;
    const report = (atEnd: boolean) => atEndRef.current?.(atEnd);
    transcriptViewportEnd.report = report;
    // A position above the end opens there, as the real viewport does.
    report(!opensAboveEndRef.current && transcriptViewportEnd.openAtEnd);
  }, []);
  useImperativeHandle(ref, () => ({
    ...transcriptViewportSpies,
    landOnMessage: (messageId) => {
      const landed = highlightListMessage(list, messageId);
      if (landed) atEndRef.current?.(false);
      return landed;
    },
    scrollToMessage: (messageId) => {
      transcriptViewportSpies.scrollToMessage(messageId);
      return (
        document.querySelector(
          `[${CHAT_MESSAGE_LIST_ATTRIBUTE}="${list}"] [data-message-id="${CSS.escape(messageId)}"]`,
        ) != null
      );
    },
  }));
  return (
    <>
      {rows.map((row) => (
        <Fragment key={transcriptRowKey(row)}>{renderRow(row)}</Fragment>
      ))}
    </>
  );
}
