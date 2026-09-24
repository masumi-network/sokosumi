"use client";

import { ChevronUp } from "lucide-react";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
 * Caption scale, not body scale. The popover answers a side question about a
 * message, so its names sit a step below the message text rather than
 * matching it; at body size the list read as louder than the transcript.
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
      <h3 className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs font-medium">
        {t("readersTitle")}
      </h3>
      <ul>
        {readers.map(({ participant, lastReadAt }) => (
          <li
            key={participant.id}
            className="flex h-7 items-center gap-2 px-2"
            data-testid={`room-seen-by-reader-${participant.id}`}
          >
            <ParticipantAvatar
              participant={participant}
              className="size-5"
              textClassName="text-[0.5rem]"
            />
            <span className="min-w-0 flex-1 truncate text-xs">
              {participantName(participant)}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {format.dateTime(lastReadAt, "time")}
            </span>
          </li>
        ))}
      </ul>
      {pending.length > 0 ? <SeenByPending pending={pending} /> : null}
    </div>
  );
}

/**
 * Who has not read yet, folded into one row until asked for.
 *
 * The question the popover answers is "who has seen my message"; the rest is
 * the remainder, so it gets a count rather than a second list as tall as the
 * first. Folded on every open — the popover unmounts, and that is the right
 * default.
 *
 * The toggle sits last and the rows open above it. The popover grows upward
 * from the faces, so the toggle stays under the pointer and the same click
 * folds the list again; sticky, so a scrolling list cannot carry it away.
 * The rows are the reader rows in grey, so the popover reads as one list
 * that grew.
 */
function SeenByPending({
  pending,
}: {
  pending: readonly ChatRoomUserParticipant[];
}) {
  const t = useTranslations("App.Channels.SeenBy");

  return (
    <Collapsible className="mt-0.5 border-t pt-0.5">
      <CollapsibleContent>
        <ul aria-label={t("notRead")}>
          {pending.map((participant) => (
            <li
              key={participant.id}
              className="flex h-7 items-center gap-2 px-2"
              data-testid={`room-seen-by-pending-${participant.id}`}
            >
              {/* Grey rather than absent: these are people who are not here
                  yet, and full-colour rows would read as readers. */}
              <ParticipantAvatar
                participant={participant}
                className="size-5 opacity-60 grayscale"
                textClassName="text-[0.5rem]"
              />
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                {participantName(participant)}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
      <div className="bg-popover sticky bottom-0">
        <CollapsibleTrigger
          className="group/pending hover:bg-accent focus-visible:ring-ring flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2 outline-none focus-visible:ring-2"
          data-testid="room-seen-by-pending-toggle"
        >
          <span className="text-muted-foreground flex-1 text-start text-xs">
            {t("pendingCount", { count: pending.length })}
          </span>
          {/* Up while folded: the rows open above. */}
          <ChevronUp
            aria-hidden
            className="text-muted-foreground size-3.5 group-data-[state=open]/pending:rotate-180 motion-safe:transition-transform"
          />
        </CollapsibleTrigger>
      </div>
    </Collapsible>
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
        // Always above. Left to choose, Radix opens it below the faces while
        // the folded popover fits over the composer, then flips it above
        // the moment the not-yet rows no longer fit. Above, it only grows
        // upward from the faces.
        side="top"
        align="end"
        className="w-56 p-1"
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
