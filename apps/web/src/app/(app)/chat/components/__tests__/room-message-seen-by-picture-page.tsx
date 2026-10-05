/** Offline layout fixture: real row, receipt and room scroller. */
import type {
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { ChatMessageRow } from "@/app/chat/components/room-message-row";
import { RoomSeenByLine } from "@/app/chat/components/room-seen-by-line";
import { RoomShellLayout } from "@/app/chat/components/room-shell-layout";
import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

export const PICTURE_URL = "https://picture-fixture.invalid/uploads/cmo.png";

function participant(index: number): ChatRoomUserParticipant {
  return {
    id: `user-${index}`,
    name: `Reader ${index}`,
    email: `reader-${index}@example.com`,
    image: null,
    presence: "offline",
  };
}

const READERS: RoomReader[] = [2, 3, 4, 5].map((index) => ({
  participant: participant(index),
  lastReadAt: new Date(Date.UTC(2026, 9, 1, 13, 30 + index)),
}));

const MESSAGE: ChatRoomMessage = {
  id: "msg-newest",
  roomId: "room-1",
  parentMessageId: null,
  content: `because I wanted to verify an implementation, I created a logo and icon.\n\n[cmo.png](${PICTURE_URL})`,
  createdAt: new Date(Date.UTC(2026, 9, 1, 13, 28)),
  deletedAt: null,
  editedAt: null,
  pinnedAt: null,
  sender: { type: "user", user: participant(1) },
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

export function PicturePage() {
  const [faces, setFaces] = useState(false);
  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });
  return (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats("h23")}
    >
      <TooltipProvider>
        <button
          type="button"
          id="read-state-arrives"
          onClick={() => setFaces(true)}
        >
          Deliver read state
        </button>
        <RoomShellLayout
          rootClassName="flex h-[600px] min-h-0 min-w-0 flex-col overflow-hidden"
          reserveDesktopHeader={false}
          composer={null}
          listContent={
            <div className="flow-root">
              <div className="h-[600px]" aria-hidden />
              <p id="previous-message">A preceding message stays still.</p>
              <div data-row="newest">
                <ChatMessageRow
                  message={MESSAGE}
                  coworkersById={new Map()}
                  coworkersBySlug={new Map()}
                  onToggleReaction={() => {}}
                  newestEndsInAttachment
                  seenBy={
                    faces ? (
                      <RoomSeenByLine
                        readers={READERS}
                        receipts={{ readers: READERS, nonReaders: [] }}
                      />
                    ) : undefined
                  }
                />
              </div>
            </div>
          }
        />
      </TooltipProvider>
    </NextIntlClientProvider>
  );
}

export function hydratePicturePage() {
  const host = document.getElementById("fixture");
  if (!host) throw new Error("Missing picture fixture host");
  hydrateRoot(host, <PicturePage />, {
    onRecoverableError(error) {
      document.body.dataset.hydrationError = String(error);
    },
  });
}
