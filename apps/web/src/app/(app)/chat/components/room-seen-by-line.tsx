"use client";

import { useFormatter, useTranslations } from "next-intl";

import type {
  RoomReader,
  RoomReadReceipts,
} from "@/app/chat/hooks/use-room-read-receipts";
import {
  ParticipantAvatar,
  participantName,
  ReadReceiptFaces,
} from "@/components/chat/read-receipt-faces";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";

/**
 * Which readers a message shows — the newest message in the transcript, and
 * nothing anywhere else.
 *
 * The rule lives here rather than inside the component because the transcript
 * has to know the answer before it renders: an empty answer means no trailing
 * slot and no reserved gutter, and asking twice in two places is how the two
 * drift apart. The data would answer this for any message; a row of faces
 * under every one of them is scrollback noise.
 */
export function seenByReadersFor({
  readersAsOf,
  messageId,
  createdAt,
  newestMessageId,
}: {
  readersAsOf: RoomReadReceipts["readersAsOf"];
  messageId: string;
  createdAt: Date | string;
  newestMessageId: string | null;
}): readonly RoomReader[] {
  if (messageId !== newestMessageId) {
    return [];
  }
  return readersAsOf(createdAt);
}

/**
 * Who has not read this far: every roster human the faces leave out.
 *
 * Not the same as `nonReaders`, which is only the people who have never opened
 * the room at all. Someone who read yesterday and has not been back has read
 * *something*, but not this — and answering "who has seen my message" while
 * quietly dropping them would be the more misleading of the two answers.
 *
 * Lagging readers come before the never-read, so the list runs from nearly
 * caught up to never here.
 */
export function seenByPendingFor({
  readers,
  allReaders,
  nonReaders,
}: {
  /** Readers as of this message — the ones the faces already show. */
  readers: readonly RoomReader[];
  /** Every reader in the room, most-recent-read first. */
  allReaders: readonly RoomReader[];
  /** Roster humans with no Room last-read at all. */
  nonReaders: readonly ChatRoomUserParticipant[];
}): readonly ChatRoomUserParticipant[] {
  const readThisFar = new Set(readers.map((reader) => reader.participant.id));
  return [
    ...allReaders
      .filter((reader) => !readThisFar.has(reader.participant.id))
      .map((reader) => reader.participant),
    ...nonReaders,
  ];
}

/**
 * The list behind the faces: who read this message and when, then who has not.
 *
 * Its own component so the transcript never reaches for a formatter it will
 * not use — the popover mounts on open, and a closed one is the normal case.
 *
 * Clock times rather than the roster's intervals. Five rows of "vor 3
 * Minuten" is five things to parse; five clock times line up in a column and
 * read as one shape. The roster shows one member at a time, where an interval
 * is the friendlier answer.
 */
function SeenByDetail({
  readers,
  pending,
}: {
  readers: readonly RoomReader[];
  pending: readonly ChatRoomUserParticipant[];
}) {
  const t = useTranslations("App.Channels.SeenBy");
  const format = useFormatter();

  return (
    <div className="max-h-64 overflow-y-auto">
      <h3 className="text-muted-foreground px-2 pt-1 pb-1 text-xs font-medium">
        {t("readersTitle")}
      </h3>
      <ul>
        {readers.map(({ participant, lastReadAt }) => (
          <li
            key={participant.id}
            className="flex items-center gap-2 px-2 py-1"
            data-testid={`room-seen-by-reader-${participant.id}`}
          >
            <ParticipantAvatar participant={participant} className="size-6" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {participantName(participant)}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {format.dateTime(lastReadAt, "time")}
            </span>
          </li>
        ))}
      </ul>
      {pending.length > 0 ? (
        <>
          <h3
            className="text-muted-foreground mt-1 border-t px-2 pt-2 pb-1 text-xs font-medium"
            data-testid="room-seen-by-pending-title"
          >
            {t("notRead")}
          </h3>
          <ul>
            {pending.map((participant) => (
              <li
                key={participant.id}
                className="flex items-center gap-2 px-2 py-1"
                data-testid={`room-seen-by-pending-${participant.id}`}
              >
                {/* Grey rather than absent: the row is about someone who is
                    not here yet, and the name alone would read as a reader. */}
                <ParticipantAvatar
                  participant={participant}
                  className="size-6 grayscale"
                />
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {participantName(participant)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

interface RoomSeenByLineProps {
  /** Readers as of this message, most-recent-read first, viewer excluded. */
  readers: readonly RoomReader[];
  /** The room's whole picture, for the half the faces cannot show. */
  receipts: Pick<RoomReadReceipts, "readers" | "nonReaders">;
}

/**
 * Seen by — the faces sit in the message column's bottom-right corner.
 *
 * The row positions them; they are out of the text flow, so the newest message
 * is exactly as tall as every other one and its last line no longer wraps
 * early to hold a gutter open.
 *
 * Faces rather than a number: at this size the count is still legible from the
 * `+N`, and a face says *who* without spending a line of copy on it. They are
 * the same faces, cap and order as the header stack, so the two surfaces never
 * disagree.
 *
 * Quiet at rest and named on demand. Grey, unringed faces in the corner read
 * as chrome rather than as the end of the sentence; clicking them answers the
 * question the count only gestures at, without sending anyone to the Members
 * panel to get it.
 *
 * Nothing renders when nobody has read that far: a guest sees no read times,
 * and an empty corner would report a boundary as a snub.
 */
export function RoomSeenByLine({ readers, receipts }: RoomSeenByLineProps) {
  const t = useTranslations("App.Channels.SeenBy");

  if (readers.length === 0) {
    return null;
  }

  const summary = t("summary", { count: readers.length });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // `group`: the faces go colour on hover, focus and open, and the
          // trigger is the only element that knows all three.
          //
          // 16px of faces is not a touch target, so the pseudo-element takes
          // it to 44. Out here in the corner it overlaps no words, which is
          // exactly what it could not have done on the last line of a
          // paragraph. Pointers do not need it, so it is gone above md.
          className="group relative flex cursor-pointer rounded-full outline-none after:absolute after:-inset-3.5 focus-visible:ring-2 focus-visible:ring-ring md:after:hidden"
          aria-label={summary}
          title={summary}
          data-testid="room-seen-by-line"
        >
          <ReadReceiptFaces readers={readers} size="sm" tone="quiet" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-60 p-1"
        data-testid="room-seen-by-detail"
      >
        <SeenByDetail
          readers={readers}
          pending={seenByPendingFor({
            readers,
            allReaders: receipts.readers,
            nonReaders: receipts.nonReaders,
          })}
        />
      </PopoverContent>
    </Popover>
  );
}
