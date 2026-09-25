import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

/** Faces shown before the rest collapse into a `+N`. */
export const READ_RECEIPT_FACE_CAP = 3;

/** What to call a member: their name, or the email until they have one. */
export function participantName(participant: ChatRoomUserParticipant): string {
  return participant.name || participant.email;
}

export function ParticipantAvatar({
  participant,
  className,
  textClassName,
}: {
  participant: ChatRoomUserParticipant;
  className?: string;
  textClassName?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={participant.image ?? undefined} alt="" />
      <AvatarFallback
        className={cn(
          "bg-muted text-muted-foreground text-[0.625rem]",
          textClassName,
        )}
      >
        {getInitials(participantName(participant))}
      </AvatarFallback>
    </Avatar>
  );
}

/** The header stack, and the smaller faces under a message. */
const FACE = {
  md: { size: "size-6", overlap: "-space-x-2" },
  sm: { size: "size-4", overlap: "-space-x-1" },
} as const;

/**
 * How loud the faces are at rest.
 *
 * `quiet` is for the faces under a message, where the receipt arrives the
 * instant you finish writing and has to not shout about it. Colour is most of
 * what shouts — three photo avatars at the end of your own sentence read as
 * content — so they sit grey until the pointer or the keyboard arrives. The
 * ring goes with it: without it they sit in the text lane rather than on it.
 *
 * It answers to a `group` ancestor, so whatever wraps the faces owns the
 * hover, the focus ring and the open state. The header stack stays `full`:
 * nothing there competes with a sentence.
 */
export type ReadReceiptFacesTone = "full" | "quiet";

const TONE: Record<ReadReceiptFacesTone, string> = {
  full: "ring-border ring-1",
  quiet:
    "opacity-70 grayscale group-hover:opacity-100 group-hover:grayscale-0 group-focus-visible:opacity-100 group-focus-visible:grayscale-0 group-data-[state=open]:opacity-100 group-data-[state=open]:grayscale-0 motion-safe:transition motion-safe:duration-150",
};

interface ReadReceiptFacesProps {
  /** Readers, most-recent-read first, viewer already excluded. */
  readers: readonly RoomReader[];
  size?: keyof typeof FACE;
  tone?: ReadReceiptFacesTone;
  className?: string;
}

/**
 * Overlapping faces, capped, with a `+N` for the rest. Purely presentational
 * and inert: whoever mounts it owns the accessible name, because a row of
 * unlabeled images is not a summary anyone can hear.
 */
export function ReadReceiptFaces({
  readers,
  size = "md",
  tone = "full",
  className,
}: ReadReceiptFacesProps) {
  const faces = readers.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = readers.length - faces.length;

  return (
    <span className={cn("flex", FACE[size].overlap, className)}>
      {faces.map(({ participant }, index) => (
        <span
          key={participant.id}
          className={cn("relative inline-flex shrink-0", FACE[size].size)}
          style={{ zIndex: faces.length - index }}
          data-testid={`read-receipt-face-${participant.id}`}
        >
          <ParticipantAvatar
            participant={participant}
            className={cn("size-full shadow-xs", TONE[tone])}
            textClassName={size === "sm" ? "text-[0.5rem]" : undefined}
          />
        </span>
      ))}
      {remainingCount > 0 ? (
        <span
          className={cn(
            "bg-muted text-muted-foreground relative inline-flex shrink-0 items-center justify-center rounded-full font-medium shadow-xs",
            FACE[size].size,
            size === "sm" ? "text-[0.5rem]" : "text-[0.625rem]",
            TONE[tone],
          )}
          style={{ zIndex: faces.length + 1 }}
          aria-hidden
        >
          +{remainingCount}
        </span>
      ) : null}
    </span>
  );
}
