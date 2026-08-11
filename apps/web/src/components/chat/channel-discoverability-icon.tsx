import { Globe2, Hash, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChannelDiscoverabilityIconProps {
  discoverability?: "public" | "private" | "external" | null;
  className?: string;
}

/**
 * Slack-like: `#` for public, lock for private, globe for external.
 * Outer size-5 matches DM avatars so every room row shares one leading column.
 * Glyph left-aligned (not centered) so thin icons share the avatar left edge.
 * Wrapper blocks sidebar `[&>svg]:size-4` override.
 */
export function ChannelDiscoverabilityIcon({
  discoverability,
  className,
}: ChannelDiscoverabilityIconProps) {
  const Icon =
    discoverability === "private"
      ? Lock
      : discoverability === "external"
        ? Globe2
        : Hash;

  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-start [&_svg]:size-3.5",
        className,
      )}
      aria-hidden
    >
      <Icon />
    </span>
  );
}
