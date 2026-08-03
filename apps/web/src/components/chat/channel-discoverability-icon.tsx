import { Hash, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChannelDiscoverabilityIconProps {
  discoverability?: "public" | "private" | null;
  className?: string;
}

/**
 * Slack-like: `#` for public, lock for private.
 * Wrapped so sidebar `[&>svg]:size-4` cannot override; size-3.5 matches text-sm.
 */
export function ChannelDiscoverabilityIcon({
  discoverability,
  className,
}: ChannelDiscoverabilityIconProps) {
  const Icon = discoverability === "private" ? Lock : Hash;

  return (
    <span
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5",
        className,
      )}
      aria-hidden
    >
      <Icon />
    </span>
  );
}
