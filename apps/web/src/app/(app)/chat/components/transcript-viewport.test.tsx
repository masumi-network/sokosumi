import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, fireEvent, render } from "@testing-library/react";
import { createRef, useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
} from "@/app/chat/chat-message-list";
import {
  CLIENT_MESSAGE_ID_METADATA_KEY,
  outboundLocalMessageId,
} from "@/app/chat/utils/outbound-room-message";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";

import {
  type TranscriptPosition,
  TranscriptViewport,
  type TranscriptViewportHandle,
} from "./transcript-viewport";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 40;
/** The scroller's height; a test shrinks it the way a growing composer does. */
let viewportHeight = VIEWPORT_HEIGHT;

/**
 * Records what is observed so a test can announce a resize of the scroller.
 * Rows are observed too and never resized here.
 */
const resizeObservations: { target: Element; callback: () => void }[] = [];
class RecordingResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    resizeObservations.push({
      target,
      callback: () => this.callback([], this),
    });
  }
  unobserve() {}
  disconnect() {}
}

/**
 * The scroller uses normal top offsets; tests express distance from latest
 * independently of the list's height.
 */
function distanceFromEnd(scroller: HTMLElement): number {
  return Math.max(
    scroller.scrollHeight - viewportHeight - scroller.scrollTop,
    0,
  );
}

/** How far the top edge is below the start of the list. */
function topOffset(scroller: HTMLElement): number {
  return scroller.scrollTop;
}

function scrollToTopOffset(scroller: HTMLElement, top: number) {
  scroller.scrollTo({ top });
}

function resizeScroller(scroller: HTMLElement, height: number) {
  // TanStack preserves the live-edge distance when the composer resizes.
  viewportHeight = height;
  act(() => {
    for (const { target, callback } of resizeObservations) {
      if (target === scroller) {
        callback();
      }
    }
  });
}

function message(index: number): ChatRoomMessage {
  return {
    id: `msg-${String(index).padStart(3, "0")}`,
    roomId: "room-1",
    parentMessageId: null,
    content: `Message ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    sender: { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
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

function rowsWithImageUnfurls(count: number): RoomTranscriptRenderRow[] {
  return rows(count).map((row) => {
    if (row.kind !== "message") {
      return row;
    }
    return {
      ...row,
      message: {
        ...row.message,
        unfurls: [
          {
            url: "https://example.com/a",
            title: "Preview",
            description: "A page",
            imageUrl: "https://blob.example/preview.png",
            siteName: "example.com",
          },
        ],
      },
    };
  });
}

function listHeight(container: HTMLElement): number {
  const list = container.querySelector<HTMLElement>(
    `[${CHAT_MESSAGE_LIST_ATTRIBUTE}] > div`,
  );
  return Number.parseFloat(list?.style.height ?? "0") || 0;
}

function boundary(cursorMessageId: string): RoomTranscriptRenderRow {
  return { kind: "boundary", cursorMessageId, isGap: false };
}

function renderRow(row: RoomTranscriptRenderRow) {
  if (row.kind === "boundary") {
    return <div data-boundary={row.cursorMessageId}>boundary</div>;
  }
  return (
    <article data-message-id={row.message.id}>{row.message.content}</article>
  );
}

/**
 * happy-dom lays nothing out: every box is zero and nothing resizes. The
 * virtualizer sizes the viewport and each mounting row from offset heights
 * and clamps scrolls to the scroller's scroll height, so those are answered
 * here from fixed heights; the list container reports where it sits relative
 * to the scroller's top edge, so the viewport's margin math holds; and
 * ResizeObserver is recorded so a test can announce a scroller resize.
 */
const shimmed = ["offsetHeight", "clientHeight", "scrollHeight"] as const;
const originalDescriptors = shimmed.map(
  (name) =>
    [
      name,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
    ] as const,
);
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const originalResizeObserver = window.ResizeObserver;

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.testid === "scroller") {
          return viewportHeight;
        }
        return this.hasAttribute("data-index") ? ROW_HEIGHT : 0;
      },
    },
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === "scroller" ? viewportHeight : 0;
      },
    },
    // The list container's height, which the virtualizer sets to its total.
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        const list = this.querySelector<HTMLElement>(
          `[${CHAT_MESSAGE_LIST_ATTRIBUTE}] > div`,
        );
        return Number.parseFloat(list?.style.height ?? "0") || 0;
      },
    },
  });
  Element.prototype.getBoundingClientRect = function () {
    const rect = originalGetBoundingClientRect.call(this).toJSON();
    const scroller = this.closest<HTMLElement>('[data-testid="scroller"]');
    if (scroller) {
      const row = this.closest<HTMLElement>("[data-index]");
      const y = row?.style.transform.match(/,\s*(-?[\d.]+)px/)?.[1];
      rect.top = scroller === this ? 0 : Number(y ?? 0) - scroller.scrollTop;
      rect.height = scroller === this ? viewportHeight : row ? ROW_HEIGHT : 0;
      rect.bottom = rect.top + rect.height;
    }
    return rect;
  };
  // On the scroller's own window: the virtualizer reads it from there, not
  // from the test's globals.
  window.ResizeObserver = RecordingResizeObserver;
});

afterAll(() => {
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  }
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  window.ResizeObserver = originalResizeObserver;
});

/**
 * The shell's part: a scroller element handed down as state, and the list
 * marker the landing mark is scoped to.
 */
function Harness({
  rows,
  handle,
  list = CHAT_MESSAGE_LIST_ROOM,
  initialPosition,
  onPositionChange,
}: {
  rows: readonly RoomTranscriptRenderRow[];
  handle: React.Ref<TranscriptViewportHandle>;
  list?: string;
  initialPosition?: TranscriptPosition;
  onPositionChange?: (position: TranscriptPosition) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setScroller} data-testid="scroller" style={{ overflowY: "auto" }}>
      <div {...{ [CHAT_MESSAGE_LIST_ATTRIBUTE]: list }}>
        <TranscriptViewport
          ref={handle}
          scroller={scroller}
          rows={rows}
          renderRow={renderRow}
          list={list}
          initialPosition={initialPosition}
          onPositionChange={onPositionChange}
          holdOffBottom={false}
        />
      </div>
    </div>
  );
}

/** The shell's part plus a composer editor, to watch the keyboard close. */
function HarnessWithComposer({
  rows,
  editorInsideScroller = false,
}: {
  rows: readonly RoomTranscriptRenderRow[];
  editorInsideScroller?: boolean;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const editor = (
    <div contentEditable data-testid="editor" role="textbox" tabIndex={0} />
  );
  return (
    <>
      <div
        ref={setScroller}
        data-testid="scroller"
        style={{ overflowY: "auto" }}
      >
        <div {...{ [CHAT_MESSAGE_LIST_ATTRIBUTE]: CHAT_MESSAGE_LIST_ROOM }}>
          <TranscriptViewport
            ref={null}
            scroller={scroller}
            rows={rows}
            renderRow={renderRow}
            holdOffBottom={false}
          />
        </div>
        {editorInsideScroller ? editor : null}
      </div>
      {editorInsideScroller ? null : editor}
    </>
  );
}

function scrollerOf(container: HTMLElement): HTMLElement {
  const scroller = container.querySelector<HTMLElement>(
    '[data-testid="scroller"]',
  );
  if (!scroller) {
    throw new Error("expected the scroller");
  }
  return scroller;
}

function mountedIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-message-id]")).map(
    (row) => row.getAttribute("data-message-id") ?? "",
  );
}

/**
 * happy-dom fires no scroll events, so the scroll the virtualizer makes to
 * reach a row is echoed back to it here, and then reported as over.
 */
async function settle(container: HTMLElement) {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
      const scroller = container.querySelector('[data-testid="scroller"]');
      scroller?.dispatchEvent(new Event("scroll"));
      scroller?.dispatchEvent(new Event("scrollend"));
    });
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.innerHTML = "";
  resizeObservations.length = 0;
  viewportHeight = VIEWPORT_HEIGHT;
  vi.useRealTimers();
});

describe("TranscriptViewport", () => {
  it("closes the keyboard when the reader drags the transcript", async () => {
    const { container } = render(<HarnessWithComposer rows={rows(80)} />);
    await settle(container);
    const editor = container.querySelector<HTMLElement>(
      '[data-testid="editor"]',
    );
    editor?.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.touchMove(scrollerOf(container));

    expect(document.activeElement).not.toBe(editor);
  });

  it("leaves the composer focused while the reader only taps the transcript", async () => {
    const { container } = render(<HarnessWithComposer rows={rows(80)} />);
    await settle(container);
    const editor = container.querySelector<HTMLElement>(
      '[data-testid="editor"]',
    );
    editor?.focus();

    const scroller = scrollerOf(container);
    fireEvent.touchStart(scroller);
    fireEvent.touchEnd(scroller);

    expect(document.activeElement).toBe(editor);
  });

  it("leaves an in-row editor focused when the drag is on the editor", async () => {
    const { container } = render(
      <HarnessWithComposer rows={rows(80)} editorInsideScroller />,
    );
    await settle(container);
    const editor = container.querySelector<HTMLElement>(
      '[data-testid="editor"]',
    );
    if (!editor) {
      throw new Error("expected the editor");
    }
    editor.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.touchMove(editor);

    expect(document.activeElement).toBe(editor);
  });

  it("leaves an in-row editor focused when the drag is elsewhere in the transcript", async () => {
    const { container } = render(
      <HarnessWithComposer rows={rows(80)} editorInsideScroller />,
    );
    await settle(container);
    const editor = container.querySelector<HTMLElement>(
      '[data-testid="editor"]',
    );
    editor?.focus();
    expect(document.activeElement).toBe(editor);

    // Scrolling back to re-read the conversation mid-edit: the edit stays
    // open, and `MessageEditComposer`'s blur does not cancel it.
    fireEvent.touchMove(scrollerOf(container));

    expect(document.activeElement).toBe(editor);
  });

  it("mounts only the rows near the live edge of a long room", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(500)} handle={handle} />);
    await settle(container);

    const ids = mountedIds(container);
    // One viewport plus the overscan on each side, not the whole room. Which
    // end is mounted is a browser question: happy-dom does not honor the
    // scroll the virtualizer makes to open on the newest row.
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(100);
  });

  it("sizes unmounted history with image unfurls taller than short text", async () => {
    const text = render(
      <Harness
        rows={rows(80)}
        handle={createRef<TranscriptViewportHandle>()}
      />,
    );
    await settle(text.container);
    const textHeight = listHeight(text.container);
    text.unmount();

    const withUnfurls = render(
      <Harness
        rows={rowsWithImageUnfurls(80)}
        handle={createRef<TranscriptViewportHandle>()}
      />,
    );
    await settle(withUnfurls.container);
    expect(listHeight(withUnfurls.container)).toBeGreaterThan(textHeight);
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

  it("marks the thread copy, not the room's, when the list is thread", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const room = document.createElement("div");
    room.setAttribute(CHAT_MESSAGE_LIST_ATTRIBUTE, CHAT_MESSAGE_LIST_ROOM);
    const roomRow = document.createElement("article");
    roomRow.setAttribute("data-message-id", "msg-010");
    room.append(roomRow);
    document.body.append(room);

    const { container } = render(
      <Harness
        rows={rows(20)}
        handle={handle}
        list={CHAT_MESSAGE_LIST_THREAD}
      />,
    );
    await settle(container);

    let landed: boolean | undefined;
    act(() => {
      landed = handle.current?.landOnMessage("msg-010");
    });
    await settle(container);

    expect(landed).toBe(true);
    expect(
      container.querySelector(`[data-message-id="msg-010"]`),
    ).toHaveAttribute("data-search-landed", "true");
    expect(roomRow.dataset.searchLanded).toBeUndefined();
  });

  it("offers a jump to latest only while the reader is above the live edge", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(500)} handle={handle} />);
    await settle(container);
    const scroller = container.querySelector<HTMLElement>(
      '[data-testid="scroller"]',
    );
    if (!scroller) {
      throw new Error("expected the scroller");
    }
    const jump = () =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "jumpToLatest",
      );

    act(() => {
      scrollToTopOffset(scroller, 0);
    });
    await settle(container);
    const control = jump();
    expect(control).toBeDefined();
    if (!control) {
      throw new Error("expected the jump control");
    }

    fireEvent.click(control);
    await settle(container);

    expect(topOffset(scroller)).toBeGreaterThan(0);
    expect(distanceFromEnd(scroller)).toBe(0);
    expect(jump()).toBeUndefined();
  });

  it("keeps the reader's row where it was when history lands above it", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const older = rows(60);
    const newer = rows(100).slice(60);
    const { container, rerender } = render(
      <Harness rows={newer} handle={handle} />,
    );
    await settle(container);
    const scroller = container.querySelector<HTMLElement>(
      '[data-testid="scroller"]',
    );
    if (!scroller) {
      throw new Error("expected the scroller");
    }
    act(() => {
      scrollToTopOffset(scroller, 0);
    });
    await settle(container);
    const first = mountedIds(container)[0];
    if (!first) {
      throw new Error("expected mounted rows");
    }
    const rowTop = (id: string) => {
      const row = container.querySelector<HTMLElement>(
        `[data-message-id="${id}"]`,
      )?.parentElement;
      const y = row?.style.transform.match(/,\s*(-?[\d.]+)px/)?.[1];
      return y === undefined ? Number.NaN : Number(y) - topOffset(scroller);
    };
    const before = rowTop(first);
    const topOffsetBefore = topOffset(scroller);
    const distanceBefore = distanceFromEnd(scroller);

    rerender(<Harness rows={[...older, ...newer]} handle={handle} />);
    await settle(container);

    expect(topOffset(scroller)).toBeGreaterThan(topOffsetBefore);
    // End anchoring compensates the inserted height above the reading row.
    expect(distanceFromEnd(scroller)).toBe(distanceBefore);
    expect(rowTop(first)).toBe(before);
  });

  it("stays on the newest row when history prepends at the live edge", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const older = rows(60);
    const newer = rows(68).slice(60);
    const { container, rerender } = render(
      <Harness rows={newer} handle={handle} />,
    );
    await settle(container);

    rerender(<Harness rows={[...older, ...newer]} handle={handle} />);
    await settle(container);

    const ids = mountedIds(container);
    expect(ids).toContain("msg-067");
    expect(ids).not.toContain("msg-000");
  });

  it("keeps the live edge in view when the scroller shrinks under a growing composer", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(100)} handle={handle} />);
    await settle(container);
    const scroller = scrollerOf(container);
    expect(distanceFromEnd(scroller)).toBe(0);

    resizeScroller(scroller, VIEWPORT_HEIGHT - 48);
    await settle(container);

    expect(distanceFromEnd(scroller)).toBe(0);
  });

  it("keeps a reader near the live edge at their distance when the scroller shrinks", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(100)} handle={handle} />);
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => {
      scrollToTopOffset(scroller, scroller.scrollHeight - viewportHeight - 100);
    });
    await settle(container);

    resizeScroller(scroller, VIEWPORT_HEIGHT - 48);
    await settle(container);

    expect(distanceFromEnd(scroller)).toBe(100);
  });

  it("keeps the live edge in view when the scroller grows under a shrinking composer", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(100)} handle={handle} />);
    await settle(container);
    const scroller = scrollerOf(container);
    expect(distanceFromEnd(scroller)).toBe(0);

    resizeScroller(scroller, VIEWPORT_HEIGHT + 48);
    await settle(container);

    expect(distanceFromEnd(scroller)).toBe(0);
  });

  it("keeps a reader near the live edge at their distance when the scroller grows", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container } = render(<Harness rows={rows(100)} handle={handle} />);
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => {
      scrollToTopOffset(scroller, scroller.scrollHeight - viewportHeight - 100);
    });
    await settle(container);

    resizeScroller(scroller, VIEWPORT_HEIGHT + 48);
    await settle(container);

    expect(distanceFromEnd(scroller)).toBe(100);
  });

  it("leaves a reader a little above the live edge where they are when the rows are refreshed", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container, rerender } = render(
      <Harness rows={rows(100)} handle={handle} />,
    );
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => {
      scrollToTopOffset(scroller, scroller.scrollHeight - viewportHeight - 100);
    });
    await settle(container);
    expect(distanceFromEnd(scroller)).toBe(100);

    // A poll returns the same messages as a new array.
    rerender(<Harness rows={rows(100)} handle={handle} />);
    await settle(container);

    expect(distanceFromEnd(scroller)).toBe(100);
  });

  it("puts a view exactly at the live edge back there when the rows are refreshed", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container, rerender } = render(
      <Harness rows={rows(100)} handle={handle} />,
    );
    await settle(container);
    const scroller = scrollerOf(container);
    expect(distanceFromEnd(scroller)).toBe(0);

    rerender(<Harness rows={rows(100)} handle={handle} />);
    await settle(container);

    expect(distanceFromEnd(scroller)).toBe(0);
  });

  it("pulls a reader near the live edge down when a new message arrives", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const { container, rerender } = render(
      <Harness rows={rows(100)} handle={handle} />,
    );
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => {
      scrollToTopOffset(scroller, scroller.scrollHeight - viewportHeight - 100);
    });
    await settle(container);

    rerender(<Harness rows={rows(101)} handle={handle} />);
    await settle(container);

    expect(distanceFromEnd(scroller)).toBeLessThan(1);
  });

  it("keeps the reader's row where it was when a new message arrives far below it", async () => {
    // A normal scroller keeps its top offset when a row arrives below it.
    const handle = createRef<TranscriptViewportHandle>();
    const { container, rerender } = render(
      <Harness rows={rows(100)} handle={handle} />,
    );
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => {
      scrollToTopOffset(
        scroller,
        scroller.scrollHeight - viewportHeight - 2000,
      );
    });
    await settle(container);
    const before = topOffset(scroller);

    rerender(<Harness rows={rows(101)} handle={handle} />);
    await settle(container);

    // The top edge is where it was; the distance from the end is what gave.
    expect(topOffset(scroller)).toBe(before);
  });

  it("does not write to the scroller under a finger, and settles once it lifts", async () => {
    // Appends below history need no scroll write or temporary margins.
    const handle = createRef<TranscriptViewportHandle>();
    const { container, rerender } = render(
      <Harness rows={rows(100)} handle={handle} />,
    );
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => {
      scrollToTopOffset(
        scroller,
        scroller.scrollHeight - viewportHeight - 2000,
      );
    });
    await settle(container);
    const before = topOffset(scroller);
    const scrollTopBefore = scroller.scrollTop;
    const list = container.querySelector<HTMLElement>(
      `[${CHAT_MESSAGE_LIST_ATTRIBUTE}] > div`,
    );

    fireEvent.touchStart(scroller);
    rerender(<Harness rows={rows(101)} handle={handle} />);
    await settle(container);

    expect(scroller.scrollTop).toBe(scrollTopBefore);
    expect(list?.style.marginBottom).toBe("");

    fireEvent.touchEnd(scroller);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(list?.style.marginBottom).toBe("");
    expect(topOffset(scroller)).toBe(before);
  });

  it("holds the first message when the boundary row above it is replaced by the page it loaded", async () => {
    // Scrolled to the very top: the boundary row sits under the top edge, so
    // it is the row the virtualizer would hold, and it is the row that goes.
    const handle = createRef<TranscriptViewportHandle>();
    const older = rows(60);
    const newer = rows(100).slice(60);
    const { container, rerender } = render(
      <Harness rows={[boundary("msg-060"), ...newer]} handle={handle} />,
    );
    await settle(container);
    const scroller = container.querySelector<HTMLElement>(
      '[data-testid="scroller"]',
    );
    if (!scroller) {
      throw new Error("expected the scroller");
    }
    act(() => {
      scrollToTopOffset(scroller, 0);
    });
    await settle(container);
    const rowTop = (id: string) => {
      const row = container.querySelector<HTMLElement>(
        `[data-message-id="${id}"]`,
      )?.parentElement;
      const y = row?.style.transform.match(/,\s*(-?[\d.]+)px/)?.[1];
      return y === undefined ? Number.NaN : Number(y) - topOffset(scroller);
    };
    expect(rowTop("msg-060")).toBe(ROW_HEIGHT);
    // Rows mount unmeasured while the virtualizer still counts the reader
    // as scrolling, and nothing lays them out later here. Let that lapse.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    rerender(
      <Harness
        rows={[boundary("msg-000"), ...older, ...newer]}
        handle={handle}
      />,
    );
    await settle(container);

    // Where it was: the page took the boundary row's place above it.
    expect(rowTop("msg-060")).toBe(ROW_HEIGHT);
    expect(mountedIds(container)).toContain("msg-059");
  });

  it("restores a measured reading position in normal scroll coordinates", async () => {
    const initialPosition: TranscriptPosition = {
      anchorId: "msg-050",
      anchorCreatedAt: message(50).createdAt.getTime(),
      offset: 17,
      atLiveEdge: false,
      visibleMessageIds: ["msg-050"],
    };
    const onPositionChange = vi.fn();
    const { container } = render(
      <Harness
        rows={rows(100)}
        handle={createRef<TranscriptViewportHandle>()}
        initialPosition={initialPosition}
        onPositionChange={onPositionChange}
      />,
    );
    await settle(container);
    const anchor = container.querySelector('[data-message-id="msg-050"]');
    expect(anchor?.getBoundingClientRect().top).toBe(-17);
    expect(onPositionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchorId: "msg-050", offset: 17 }),
    );
  });

  it("defers an older prefix while keeping visible streaming content live", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const newer = rows(70).slice(40);
    const { container, rerender } = render(
      <Harness rows={newer} handle={handle} />,
    );
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => scrollToTopOffset(scroller, 0));
    await settle(container);
    fireEvent.touchStart(scroller);
    const updated = rows(70)
      .slice(10)
      .map((row) =>
        row.kind === "message" && row.message.id === "msg-040"
          ? { ...row, message: { ...row.message, content: "Streaming now" } }
          : row,
      );
    rerender(<Harness rows={updated} handle={handle} />);
    expect(container.textContent).toContain("Streaming now");
    expect(mountedIds(container)).not.toContain("msg-039");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mountedIds(container)).not.toContain("msg-039");
    fireEvent.touchEnd(scroller);
    await settle(container);
    expect(mountedIds(container)).toContain("msg-039");
  });

  it("keeps an older prefix deferred when its oldest displayed message is deleted", async () => {
    const handle = createRef<TranscriptViewportHandle>();
    const newer = rows(70).slice(40);
    const { container, rerender } = render(
      <Harness rows={newer} handle={handle} />,
    );
    await settle(container);
    const scroller = scrollerOf(container);
    act(() => scrollToTopOffset(scroller, 0));
    await settle(container);
    fireEvent.touchStart(scroller);
    const loaded = rows(70).slice(10);
    rerender(<Harness rows={loaded} handle={handle} />);
    const deleted = loaded.filter(
      (row) => row.kind !== "message" || row.message.id !== "msg-040",
    );
    rerender(<Harness rows={deleted} handle={handle} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mountedIds(container)).not.toContain("msg-040");
    expect(mountedIds(container)).not.toContain("msg-039");
    fireEvent.touchEnd(scroller);
    await settle(container);
    expect(mountedIds(container)).toContain("msg-039");
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
