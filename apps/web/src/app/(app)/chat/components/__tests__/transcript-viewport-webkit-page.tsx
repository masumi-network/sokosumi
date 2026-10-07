/**
 * The page `transcript-viewport.webkit.test.ts` opens in WebKit: the real
 * viewport in the real room shell, with the Seen by faces on the newest row.
 * It walks the reader up past the point where that row leaves the overscan
 * and leaves what happened on `document.body` for the test to read.
 */
import type {
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { Component, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";

import { RoomSeenByLine } from "@/app/chat/components/room-seen-by-line";
import { RoomShellLayout } from "@/app/chat/components/room-shell-layout";
import { TranscriptViewport } from "@/app/chat/components/transcript-viewport";
import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

/** What the test reads back, as JSON on `document.body.dataset.walk`. */
export interface TranscriptWalkResult {
  /** The message of whatever the error boundary caught, or null. */
  error: string | null;
  newestRowMountedAtStart: boolean;
  seenByMountedAtStart: boolean;
  newestRowMountedAtEnd: boolean;
}

const ROW_COUNT = 40;
const NEWEST = ROW_COUNT - 1;
/** Coarse steps find where the newest row leaves; then it is crossed by 1px. */
const COARSE_PX = 20;

function participant(index: number): ChatRoomUserParticipant {
  return {
    id: `user-${index}`,
    name: `Reader ${index}`,
    email: `reader-${index}@example.com`,
    image: null,
    presence: "offline",
  };
}

const READERS: RoomReader[] = [1, 2, 3].map((index) => ({
  participant: participant(index),
  lastReadAt: new Date(Date.UTC(2026, 0, 1, 1, index)),
}));

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

const NEWEST_MESSAGE_ID = message(NEWEST).id;

const ROWS: RoomTranscriptRenderRow[] = Array.from(
  { length: ROW_COUNT },
  (_, index) => ({
    kind: "message",
    message: message(index),
    previousMessage: undefined,
    dayPreviousMessage: undefined,
  }),
);

/**
 * A message row down to what the bug needs: a positioned box with the body,
 * and on the newest one the Seen by faces in the corner `ChatMessageRow`
 * gives them.
 */
function renderRow(row: RoomTranscriptRenderRow): ReactNode {
  if (row.kind !== "message") {
    return null;
  }
  return (
    <article className="relative flex min-w-0 gap-3.5 py-2">
      {row.message.id === NEWEST_MESSAGE_ID ? (
        <div className="absolute end-2 bottom-1 z-10">
          <RoomSeenByLine
            readers={READERS}
            receipts={{ readers: READERS, nonReaders: [] }}
          />
        </div>
      ) : null}
      <p className="text-base leading-6 md:text-sm">{row.message.content}</p>
    </article>
  );
}

let caught: Error | null = null;

class CatchError extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    caught = error;
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Room() {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  return (
    <RoomShellLayout
      rootClassName="flex h-[600px] min-h-0 min-w-0 flex-col overflow-hidden"
      reserveDesktopHeader={false}
      listScrollerRef={setScroller}
      listContent={
        <TranscriptViewport
          ref={() => {}}
          scroller={scroller}
          rows={ROWS}
          renderRow={renderRow}
          holdOffBottom={false}
        />
      }
      composer={null}
    />
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function newestRowMounted(): boolean {
  return document.querySelector(`[data-index="${NEWEST}"]`) !== null;
}

async function walk(): Promise<TranscriptWalkResult> {
  await nextFrame();
  await nextFrame();
  const newestRowMountedAtStart = newestRowMounted();
  const seenByMountedAtStart =
    document.querySelector('[data-testid="room-seen-by-line"]') !== null;
  const scroller = document.querySelector<HTMLElement>(".overflow-y-auto");
  if (scroller) {
    const farthest = -(scroller.scrollHeight - scroller.clientHeight);
    let left = 0;
    while (left > farthest && newestRowMounted() && !caught) {
      left -= COARSE_PX;
      scroller.scrollTop = left;
      await nextFrame();
    }
    // Back to where the row is still mounted, then across one pixel at a
    // time: the offsets that loop are two pixels wide.
    scroller.scrollTop = left + 2 * COARSE_PX;
    await nextFrame();
    for (
      let top = left + 2 * COARSE_PX - 1;
      top >= left - COARSE_PX && !caught;
      top -= 1
    ) {
      scroller.scrollTop = top;
      await nextFrame();
    }
    await nextFrame();
  }
  return {
    error: caught ? caught.message : null,
    newestRowMountedAtStart,
    seenByMountedAtStart,
    newestRowMountedAtEnd: newestRowMounted(),
  };
}

const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(
  <NextIntlClientProvider
    locale="en"
    messages={messages}
    timeZone="UTC"
    formats={createFormats("h23")}
  >
    <TooltipProvider>
      <CatchError>
        <Room />
      </CatchError>
    </TooltipProvider>
  </NextIntlClientProvider>,
);

void walk().then((result) => {
  document.body.dataset.walk = JSON.stringify(result);
});
