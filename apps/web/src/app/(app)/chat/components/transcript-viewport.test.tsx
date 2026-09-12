import { act, render } from "@testing-library/react";
import { createRef, useState } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
} from "@/app/chat/chat-message-list";
import {
  CLIENT_MESSAGE_ID_METADATA_KEY,
  outboundLocalMessageId,
} from "@/app/chat/utils/outbound-room-message";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  TranscriptViewport,
  type TranscriptViewportHandle,
} from "./transcript-viewport";

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 40;

function message(index: number): ChatRoomMessage {
  return {
    id: `msg-${String(index).padStart(3, "0")}`,
    roomId: "room-1",
    parentMessageId: null,
    content: `Message ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    deletedAt: null,
    editedAt: null,
    sender: { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
  };
}

function rows(count: number): RoomTranscriptRenderRow[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "message",
    message: message(index),
    previousMessage: undefined,
    dayPreviousMessage: undefined,
  }));
}

function renderRow(row: RoomTranscriptRenderRow) {
  if (row.kind === "boundary") {
    return <div>boundary</div>;
  }
  return (
    <article data-message-id={row.message.id}>{row.message.content}</article>
  );
}

/**
 * The shell's part: a scroller element handed down as state, and the list
 * marker the landing mark is scoped to.
 */
function Harness({
  rows,
  handle,
}: {
  rows: readonly RoomTranscriptRenderRow[];
  handle: React.Ref<TranscriptViewportHandle>;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <VirtuosoMockContext.Provider
      value={{ viewportHeight: VIEWPORT_HEIGHT, itemHeight: ROW_HEIGHT }}
    >
      <div
        ref={setScroller}
        data-testid="scroller"
        style={{ overflowY: "auto" }}
      >
        <div {...{ [CHAT_MESSAGE_LIST_ATTRIBUTE]: CHAT_MESSAGE_LIST_ROOM }}>
          <TranscriptViewport
            ref={handle}
            scroller={scroller}
            rows={rows}
            renderRow={renderRow}
            holdOffBottom={false}
          />
        </div>
      </div>
    </VirtuosoMockContext.Provider>
  );
}

function mountedIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-message-id]")).map(
    (row) => row.getAttribute("data-message-id") ?? "",
  );
}

/**
 * happy-dom lays nothing out and fires no scroll events, so the scroll
 * Virtuoso makes to reach the initial row is echoed back to it here. The
 * mock context supplies the heights.
 */
async function settle(container: HTMLElement) {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      container
        .querySelector('[data-testid="scroller"]')
        ?.dispatchEvent(new Event("scroll"));
    });
  }
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TranscriptViewport", () => {
  it("mounts only the rows near the live edge of a long room", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(500)} handle={handle} />);
    await settle(container);

    const ids = mountedIds(container);
    // One viewport plus the overscan on each side, not the whole room. Which
    // end is mounted is a browser question: happy-dom does not honor the
    // scroll Virtuoso makes to open on the newest row.
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(100);
  });

  it("lands on a message the room holds and marks its row", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(500)} handle={handle} />);
    await settle(container);
    const target = mountedIds(container).at(-3);
    if (!target) {
      throw new Error("expected a mounted row to land on");
    }

    let landed: boolean | undefined;
    act(() => {
      landed = handle.current?.landOnMessage(target);
    });
    await settle(container);

    expect(landed).toBe(true);
    expect(
      container.querySelector(`[data-message-id="${target}"]`),
    ).toHaveAttribute("data-search-landed", "true");
  });

  it("reports a message the room has not loaded", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(20)} handle={handle} />);
    await settle(container);

    expect(handle.current?.landOnMessage("msg-999")).toBe(false);
    expect(handle.current?.scrollToMessage("msg-999")).toBe(false);
  });

  it("keeps row identity when an outbound shell is confirmed", async () => {
    // Same client turn, new message id: one row, so the delivery chrome can
    // transition without a remount.
    const handle = createRef<TranscriptViewportHandle>();
    const pending: ChatRoomMessage = {
      ...message(0),
      id: outboundLocalMessageId("turn-1"),
    };
    const confirmed: ChatRoomMessage = {
      ...message(0),
      id: "msg-server",
      metadata: { [CLIENT_MESSAGE_ID_METADATA_KEY]: "turn-1" },
    };
    const asRow = (row: ChatRoomMessage): RoomTranscriptRenderRow => ({
      kind: "message",
      message: row,
      previousMessage: undefined,
      dayPreviousMessage: undefined,
    });
    const { container, rerender } = render(
      <Harness rows={[asRow(pending)]} handle={handle} />,
    );
    await settle(container);
    const before = container.querySelector("[data-message-id]");

    rerender(<Harness rows={[asRow(confirmed)]} handle={handle} />);
    await settle(container);
    const after = container.querySelector("[data-message-id]");

    expect(after?.getAttribute("data-message-id")).toBe("msg-server");
    expect(after?.parentElement).toBe(before?.parentElement);
  });
});
