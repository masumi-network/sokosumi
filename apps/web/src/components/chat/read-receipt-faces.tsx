import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

/** Faces shown before the rest collapse into a `+N`. */
export const READ_RECEIPT_FACE_CAP = 3;

function participantName(participant: ChatRoomUserParticipant): string {
  return participant.name || participant.email;
}

function ParticipantAvatar({
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

/**
 * The header stack, and the smaller faces under a message.
 *
 * Each size carries its classes and its pixels together, because the
 * transcript has to know the width before layout and Tailwind cannot scan a
 * class name built at runtime. Keeping the twins in one literal means a face
 * size is one edit rather than a hunt through four constants.
 */
const FACE = {
  md: { size: "size-6", px: 24, overlap: "-space-x-2", overlapPx: 8 },
  sm: { size: "size-4", px: 16, overlap: "-space-x-1", overlapPx: 4 },
} as const;

/**
 * How wide the faces will render, in px.
 *
 * The transcript needs this before layout: it reserves exactly this much at the
 * end of the message so the last line wraps early and the faces stay on it
 * rather than dropping to a row of their own. Derived from the same constants
 * the component renders with, so the reservation cannot drift from the render.
 */
export function readReceiptFacesWidth(
  readerCount: number,
  size: keyof typeof FACE = "md",
): number {
  const faces = Math.min(readerCount, READ_RECEIPT_FACE_CAP);
  const slots = faces + (readerCount > faces ? 1 : 0);
  if (slots === 0) {
    return 0;
  }
  const { px, overlapPx } = FACE[size];
  return px + (slots - 1) * (px - overlapPx);
}

interface ReadReceiptFacesProps {
  /** Readers, most-recent-read first, viewer already excluded. */
  readers: readonly RoomReader[];
  size?: keyof typeof FACE;
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
            className="ring-border size-full shadow-xs ring-1"
            textClassName={size === "sm" ? "text-[0.5rem]" : undefined}
          />
        </span>
      ))}
      {remainingCount > 0 ? (
        <span
          className={cn(
            "bg-muted text-muted-foreground ring-border relative inline-flex shrink-0 items-center justify-center rounded-full font-medium shadow-xs ring-1",
            FACE[size].size,
            size === "sm" ? "text-[0.5rem]" : "text-[0.625rem]",
          )}
          style={{ zIndex: 0 }}
          aria-hidden
        >
          +{remainingCount}
        </span>
      ) : null}
    </span>
  );
}
