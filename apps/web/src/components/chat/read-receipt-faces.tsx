import type { ChatRoomUserParticipant } from "@sokosumi/core-client";
import type { RoomReader } from "@/app/chat/hooks/use-room-read-receipts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  monogram = false,
}: {
  participant: ChatRoomUserParticipant;
  className?: string;
  /** One initial instead of two, for faces too small to fit both. */
  monogram?: boolean;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={participant.image ?? undefined} alt="" />
      <AvatarFallback className="bg-muted text-muted-foreground text-2xs">
        {getInitials(participantName(participant)).slice(0, monogram ? 1 : 2)}
      </AvatarFallback>
    </Avatar>
  );
}

/** The header stack, and the smaller faces under a message. */
const FACE = {
  md: { size: "size-6", count: "h-6 min-w-6", overlap: "-space-x-2" },
  // The `+N` grows into a pill past one digit: two at `text-2xs` overflow 16px.
  sm: { size: "size-4", count: "h-4 min-w-4 px-0.5", overlap: "-space-x-1" },
} as const;

/**
 * How loud the faces are.
 *
 * `quiet` is for the faces under a message, where the receipt arrives the
 * instant you finish writing and has to not shout about it. Colour is most of
 * what shouts, even pulled back, so the stack sits grey at half opacity until
 * the faces themselves are hovered, focused or open. Opacity and grayscale are
 * on the stack, not each face: per-face opacity composites the overlap, so the
 * seam reads darker than the rest. The ring goes too: without it they sit in
 * the text lane rather than on it.
 *
 * It answers to a `group/seen-by` ancestor, so whatever wraps the faces owns
 * the hover, the focus ring and the open state. Named, because the message
 * row is a bare `group` and a bare `group-hover:` wakes on any `.group`
 * ancestor, so hovering the message would colour them. Tailwind 4 already
 * wraps `group-hover` in `@media (hover: hover)`, so a tap does not leave the
 * faces coloured.
 *
 * The header stack stays `full`: nothing there competes with a sentence.
 */
export type ReadReceiptFacesTone = "full" | "quiet";

const TONE: Record<ReadReceiptFacesTone, string | undefined> = {
  full: "ring-border ring-1",
  quiet: undefined,
};

const QUIET_STACK =
  "opacity-50 grayscale group-hover/seen-by:opacity-100 group-hover/seen-by:grayscale-0 group-focus-visible/seen-by:opacity-100 group-focus-visible/seen-by:grayscale-0 group-data-[state=open]/seen-by:opacity-100 group-data-[state=open]/seen-by:grayscale-0 motion-safe:transition-[opacity,filter] motion-safe:duration-150";

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
    <span
      className={cn(
        "flex",
        FACE[size].overlap,
        tone === "quiet" && QUIET_STACK,
        className,
      )}
    >
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
            monogram={size === "sm"}
          />
        </span>
      ))}
      {remainingCount > 0 ? (
        <span
          className={cn(
            "bg-muted text-muted-foreground relative inline-flex shrink-0 items-center justify-center rounded-full font-medium shadow-xs",
            FACE[size].count,
            "text-2xs",
            TONE[tone],
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
