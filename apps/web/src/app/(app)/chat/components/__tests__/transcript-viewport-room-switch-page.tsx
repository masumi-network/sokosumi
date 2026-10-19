/**
 * The page `transcript-viewport-room-switch.webkit.test.ts` opens: two rooms
 * painted from a retained transcript, switched the way `PersistentRoomView`
 * switches them. Each room remounts its whole shell (scroller included) and
 * restores the reading position the previous visit saved.
 *
 * Query flags pick what the rows do:
 * - `tall`: some rows carry a block the row estimate cannot see, as result
 *   cards and images do, so they measure far taller than estimated.
 * - `previews`: some rows show a one-line loading state, then a card.
 * - `refresh`: the mount refresh replaces every row with a new object.
 */
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";

import { RoomShellLayout } from "@/app/chat/components/room-shell-layout";
import {
  type TranscriptPosition,
  TranscriptViewport,
} from "@/app/chat/components/transcript-viewport";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

/** One frame of the open room after a switch. */
export interface RoomSwitchFrame {
  room: string;
  /** Rows of the open room intersecting the scroller. */
  rowsInView: number;
  jumpToLatest: boolean;
  distanceFromEnd: number;
}

declare global {
  interface Window {
    /** Switch rooms, then sample frames until `frames` have passed. */
    switchRoom: (room: string, frames: number) => Promise<RoomSwitchFrame[]>;
  }
}

const params = new URLSearchParams(window.location.search);
const REFRESH = params.has("refresh");
const PREVIEWS = params.has("previews");
const TALL = params.has("tall");
const ROW_COUNT = 40;

function message(room: string, index: number): ChatRoomMessage {
  return {
    id: `${room}-${String(index).padStart(3, "0")}`,
    roomId: room,
    parentMessageId: null,
    content: `${room} message ${index}${"\nmore text".repeat(index % 4)}`,
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

function roomRows(room: string): RoomTranscriptRenderRow[] {
  return Array.from({ length: ROW_COUNT }, (_, index) => ({
    kind: "message",
    message: message(room, index),
    previousMessage: undefined,
    dayPreviousMessage: undefined,
  }));
}

/** The retained cache: transcripts and positions outlive the room view. */
const transcripts = new Map<string, RoomTranscriptRenderRow[]>();
const positions = new Map<string, TranscriptPosition>();

/** A one-line loading state that becomes a card, like result previews. */
function Preview() {
  const [loaded, setLoaded] = useState(false);
  useMountEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 150);
    return () => clearTimeout(timer);
  });
  return loaded ? (
    <div className="h-40 rounded border">card</div>
  ) : (
    <p className="text-sm">Loading preview…</p>
  );
}

function renderRow(row: RoomTranscriptRenderRow): ReactNode {
  if (row.kind !== "message") return null;
  const index = Number(row.message.id.split("-")[1]);
  return (
    <article
      data-message-id={row.message.id}
      className="relative flex min-w-0 flex-col gap-1 py-2"
    >
      <p className="text-base leading-6 whitespace-pre-wrap md:text-sm">
        {row.message.content}
      </p>
      {PREVIEWS && index % 3 === 0 ? <Preview /> : null}
      {TALL && index % 4 === 1 ? (
        <div className="h-[400px] rounded border">image</div>
      ) : null}
    </article>
  );
}

function Room({ room }: { room: string }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [rows, setRows] = useState(() => {
    const cached = transcripts.get(room) ?? roomRows(room);
    transcripts.set(room, cached);
    return cached;
  });
  const [initialPosition] = useState(() => positions.get(room));
  useMountEffect(() => {
    if (!REFRESH) return;
    // The mount refresh: same messages, every object new.
    const timer = setTimeout(() => {
      const next = rows.map((row) =>
        row.kind === "message"
          ? { ...row, message: { ...row.message } }
          : { ...row },
      );
      transcripts.set(room, next);
      setRows(next);
    }, 50);
    return () => clearTimeout(timer);
  });
  return (
    <RoomShellLayout
      rootClassName="flex h-[600px] min-h-0 min-w-0 flex-col overflow-hidden"
      desktopHeader={<span>{room}</span>}
      listScrollerRef={setScroller}
      listContent={
        <TranscriptViewport
          key={room}
          ref={() => {}}
          scroller={scroller}
          rows={rows}
          initialPosition={initialPosition}
          onPositionChange={(saved) => {
            positions.set(room, saved);
          }}
          renderRow={renderRow}
          holdOffBottom={false}
        />
      }
      composer={<div className="h-24 shrink-0 border-t">composer</div>}
    />
  );
}

let setOpenRoom: (room: string) => void = () => {};

function App() {
  const [room, setRoom] = useState("a");
  setOpenRoom = setRoom;
  return <Room key={room} room={room} />;
}

function sample(room: string): RoomSwitchFrame {
  const scroller = document.querySelector<HTMLElement>(".overflow-y-auto");
  if (!scroller)
    return { room, rowsInView: 0, jumpToLatest: false, distanceFromEnd: -1 };
  const edge = scroller.getBoundingClientRect();
  const rowsInView = Array.from(
    scroller.querySelectorAll<HTMLElement>(`[data-message-id^="${room}-"]`),
  ).filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > edge.top && rect.top < edge.bottom;
  }).length;
  return {
    room,
    rowsInView,
    jumpToLatest: Array.from(scroller.querySelectorAll("button")).some(
      (button) => button.textContent?.includes("Jump to latest"),
    ),
    distanceFromEnd: Math.round(
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
    ),
  };
}

window.switchRoom = (room, frames) =>
  new Promise((resolve) => {
    const seen: RoomSwitchFrame[] = [];
    setOpenRoom(room);
    const tick = () => {
      seen.push(sample(room));
      if (seen.length >= frames) resolve(seen);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(
  <NextIntlClientProvider
    locale="en"
    messages={messages}
    timeZone="UTC"
    formats={createFormats("h23")}
  >
    <App />
  </NextIntlClientProvider>,
);
