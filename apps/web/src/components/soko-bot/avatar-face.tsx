import { cn } from "@/lib/utils";

import { AvatarLoop } from "./avatar-loop";

interface AvatarFaceProps {
  /** The still. */
  src: string;
  crafted: boolean;
  alt?: string;
  className?: string;
  /** The state's loop, played while `playing`. */
  loopSrc?: string | null;
  playing?: boolean;
  onEnded?: () => void;
}

/**
 * A bot's small round face. A crafted avatar is a whole scene (a creature at
 * its desk), so a small face crops it to the creature's head; a mascot is
 * already a face and fills the circle.
 */
export function AvatarFace({
  src,
  crafted,
  alt = "",
  className,
  loopSrc = null,
  playing = false,
  onEnded,
}: AvatarFaceProps) {
  const media = (mediaClass: string) => (
    <AvatarLoop
      poster={src}
      src={loopSrc}
      playing={playing}
      onEnded={onEnded}
      alt={alt}
      className={mediaClass}
    />
  );
  if (!crafted) {
    return media(cn("shrink-0 rounded-full object-cover", className));
  }
  return (
    <span
      className={cn(
        "bg-muted relative block shrink-0 overflow-hidden rounded-full",
        className,
      )}
    >
      {media("absolute -top-[51%] -left-[89%] block size-[240%] max-w-none")}
    </span>
  );
}
