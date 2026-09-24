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
 * The list behind the faces: who read this message and when.
 *
 * Its own component so the transcript never reaches for a formatter it will
 * not use — the popover mounts on open, and a closed one is the normal case.
 *
 * Readers only. The popover answers "who has seen my message"; who has not is
 * the Members panel's job. A folded not-yet section was tried and dropped: a
 * second list that grows the popover on demand is more motion than a side
 * question is worth.
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
function SeenByDetail({ readers }: { readers: readonly RoomReader[] }) {
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
    </div>
  );
}

interface RoomSeenByLineProps {
  /** Readers as of this message, most-recent-read first, viewer excluded. */
  readers: readonly RoomReader[];
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
export function RoomSeenByLine({ readers }: RoomSeenByLineProps) {
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
        // Always above, over the transcript. Left to choose, Radix opens it
        // below the faces over the composer while it fits there and above
        // once it does not, so the same popover lands in two places.
        side="top"
        align="end"
        className="w-56 p-1"
        data-testid="room-seen-by-detail"
      >
        <SeenByDetail readers={readers} />
      </PopoverContent>
    </Popover>
  );
}
