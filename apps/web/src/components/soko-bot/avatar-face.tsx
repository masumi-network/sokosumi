import { cn } from "@/lib/utils";

interface AvatarFaceProps {
  src: string;
  crafted: boolean;
  alt?: string;
  className?: string;
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
}: AvatarFaceProps) {
  if (!crafted) {
    return (
      <img
        src={src}
        alt={alt}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "bg-muted relative block shrink-0 overflow-hidden rounded-full",
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        className="absolute -top-[51%] -left-[89%] block size-[240%] max-w-none"
      />
    </span>
  );
}
