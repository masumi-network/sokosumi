"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

/** Faces in the header before the rest collapse into a `+N`. */
export const READ_RECEIPT_FACE_CAP = 3;

interface ReadReceiptAvatarStackProps {
  /** Room readers, most-recent-read first, viewer already excluded. */
  readers: readonly RoomReader[];
  /** Roster humans with no Room last-read, viewer already excluded. */
  nonReaders: readonly ChatRoomUserParticipant[];
  className?: string;
}

function participantName(participant: ChatRoomUserParticipant): string {
  return participant.name || participant.email;
}

function ParticipantAvatar({
  participant,
  className,
}: {
  participant: ChatRoomUserParticipant;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={participant.image ?? undefined} alt="" />
      <AvatarFallback className="bg-muted text-muted-foreground text-[0.625rem]">
        {getInitials(participantName(participant))}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The expanded list. Its own component so the read times are formatted only
 * once the popover is open — the closed stack never reaches for a formatter.
 */
function ReadReceiptReaderList({
  readers,
  nonReaders,
}: {
  readers: readonly RoomReader[];
  nonReaders: readonly ChatRoomUserParticipant[];
}) {
  const t = useTranslations("App.Channels.SeenBy");
  const format = useFormatter();

  return (
    <>
      <p className="text-sm font-semibold">{t("title")}</p>
      <ul className="mt-2 space-y-2">
        {readers.map(({ participant, lastReadAt }) => (
          <li key={participant.id} className="flex items-center gap-2">
            <ParticipantAvatar
              participant={participant}
              className="size-6 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {participantName(participant)}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {t("readAt", { time: format.relativeTime(lastReadAt) })}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {nonReaders.length > 0 ? (
        <>
          <p className="text-muted-foreground mt-3 text-xs font-medium">
            {t("notReadTitle")}
          </p>
          <ul className="mt-2 space-y-2">
            {nonReaders.map((participant) => (
              <li key={participant.id} className="flex items-center gap-2">
                <ParticipantAvatar
                  participant={participant}
                  className="size-6 shrink-0 opacity-60"
                />
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {participantName(participant)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/**
 * Seen by — who on the Room roster has read the room.
 *
 * Three faces and a `+N`, because a fifty-person Channel must not fill its
 * header with avatars. The button is the whole summary to assistive
 * technology: one accessible name saying how many people have read, rather
 * than a row of unlabeled images. Opening it lists every reader with when they
 * last read, then the members who have not read at all — "who is missing" is a
 * fact to read, not one to derive.
 *
 * A popover rather than a hover card: the detail must not be gated on hover,
 * and a popover is the one that opens from the keyboard and moves focus into
 * the list.
 *
 * Nothing renders when nobody has read. A guest sees no read times at all, so
 * their reader list is empty and this disappears rather than claiming zero.
 */
export function ReadReceiptAvatarStack({
  readers,
  nonReaders,
  className,
}: ReadReceiptAvatarStackProps) {
  const t = useTranslations("App.Channels.SeenBy");

  if (readers.length === 0) {
    return null;
  }

  const faces = readers.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = readers.length - faces.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // The pseudo-element carries the touch target out to 44px below md,
          // where the faces themselves are only 24px tall.
          className={cn(
            "relative flex -space-x-2 cursor-pointer rounded-full outline-none after:absolute after:-inset-2 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring md:after:hidden",
            className,
          )}
          aria-label={t("summary", { count: readers.length })}
          title={t("open")}
          data-testid="read-receipt-stack"
        >
          {faces.map(({ participant }, index) => (
            <span
              key={participant.id}
              className="relative inline-flex size-6 shrink-0"
              style={{ zIndex: faces.length - index }}
              data-testid={`read-receipt-face-${participant.id}`}
            >
              <ParticipantAvatar
                participant={participant}
                className="ring-border size-full shadow-xs ring-1"
              />
            </span>
          ))}
          {remainingCount > 0 ? (
            <span
              className="bg-muted text-muted-foreground ring-border relative inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium shadow-xs ring-1"
              style={{ zIndex: 0 }}
              aria-hidden
            >
              +{remainingCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-3"
        data-testid="read-receipt-list"
      >
        <ReadReceiptReaderList readers={readers} nonReaders={nonReaders} />
      </PopoverContent>
    </Popover>
  );
}
