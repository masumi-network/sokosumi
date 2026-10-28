/**
 * The page `transcript-viewport-follow.webkit.test.ts` opens: the real
 * viewport in the real room shell with real message rows, at the live edge.
 * "Type a line" grows the composer a line; "Send" empties it and appends a
 * continuation from the newest row's sender, pinned the way rooms-client
 * pins its own sends.
 */
import type {
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { ChatMessageRow } from "@/app/chat/components/room-message-row";
import { RoomSeenByLine } from "@/app/chat/components/room-seen-by-line";
import { RoomShellLayout } from "@/app/chat/components/room-shell-layout";
import {
  TranscriptViewport,
  type TranscriptViewportHandle,
} from "@/app/chat/components/transcript-viewport";
import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import type { RoomTranscriptRenderRow } from "@/app/chat/utils/room-transcript-ranges";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

function user(index: number): ChatRoomUserParticipant {
  return {
    id: `user-${index}`,
    name: `Writer ${index}`,
    email: `writer-${index}@example.com`,
    image: null,
    presence: "offline",
  };
}

const READERS: RoomReader[] = [5, 6].map((index) => ({
  participant: user(index),
  lastReadAt: new Date(Date.UTC(2026, 9, 28, 9)),
}));

function message(index: number, content: string): ChatRoomMessage {
  return {
    id: `msg-${String(index).padStart(3, "0")}`,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date(Date.UTC(2026, 9, 28, 8, 0, index)),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    // Pairs from one writer, so the newest starts a continuation run.
    sender: { type: "user", user: user(Math.floor(index / 2) % 3) },
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

function rowsOf(list: ChatRoomMessage[]): RoomTranscriptRenderRow[] {
  return list.map((item, index) => ({
    kind: "message",
    message: item,
    previousMessage: list[index - 1],
    dayPreviousMessage: list[index - 1],
  }));
}

const OPENING = Array.from({ length: 40 }, (_, index) =>
  message(index, `Message ${index}: ${"words ".repeat(12 + (index % 5) * 9)}`),
);

function FollowRoom() {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [list, setList] = useState(OPENING);
  // A draft's lines: the composer grows a line at a time, like the editor.
  const [draftLines, setDraftLines] = useState(1);
  const viewport = useRef<TranscriptViewportHandle>(null);
  const rows = rowsOf(list);
  const newestId = list.at(-1)?.id;
  const appendSent = () =>
    setList((current) => {
      const last = current[current.length - 1];
      return [
        ...current,
        {
          ...message(current.length, `Sent ${"words ".repeat(30)}`),
          id: "sent",
          sender: last.sender,
        },
      ];
    });
  return (
    <>
      <button
        type="button"
        data-testid="type-line"
        onClick={() => setDraftLines((lines) => lines + 1)}
      >
        Type a line
      </button>
      <button
        type="button"
        // What rooms-client does on send: the composer empties, the shell
        // appends, and the view is pinned to it.
        data-testid="send"
        onClick={() => {
          setDraftLines(1);
          appendSent();
          viewport.current?.pinToBottomAfterOwnSend();
        }}
      >
        Send
      </button>
      <RoomShellLayout
        rootClassName="flex h-[calc(100dvh-40px)] min-h-0 min-w-0 flex-col overflow-hidden"
        reserveDesktopHeader={false}
        listScrollerRef={setScroller}
        listContent={
          <TranscriptViewport
            ref={viewport}
            scroller={scroller}
            rows={rows}
            renderRow={(row) =>
              row.kind === "message" ? (
                <div data-message-id={row.message.id}>
                  <ChatMessageRow
                    message={row.message}
                    coworkersById={new Map()}
                    coworkersBySlug={new Map()}
                    onToggleReaction={() => {}}
                    isContinuation={
                      row.previousMessage?.sender.type === "user" &&
                      row.message.sender.type === "user" &&
                      row.previousMessage.sender.user.id ===
                        row.message.sender.user.id
                    }
                    seenBy={
                      row.message.id === newestId ? (
                        <RoomSeenByLine
                          readers={READERS}
                          receipts={{ readers: READERS, nonReaders: [] }}
                        />
                      ) : undefined
                    }
                  />
                </div>
              ) : null
            }
            holdOffBottom={false}
            onAtEndChange={(atEnd) => {
              document.body.dataset.atEnd = String(atEnd);
            }}
          />
        }
        composer={
          <div
            className="shrink-0 border-t"
            style={{ height: 76 + draftLines * 20 }}
          />
        }
      />
    </>
  );
}

export function renderFollowPage() {
  const host = document.getElementById("fixture");
  if (!host) throw new Error("Missing follow fixture host");
  createRoot(host).render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats("h23")}
    >
      <TooltipProvider>
        <FollowRoom />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}
