import { Hash, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChannelDiscoverabilityIconProps {
  discoverability?: "public" | "private" | null;
  className?: string;
}

/** Slack-like: `#` for public, lock for private. */
export function ChannelDiscoverabilityIcon({
  discoverability,
  className,
}: ChannelDiscoverabilityIconProps) {
  if (discoverability === "private") {
    return <Lock className={cn("size-4 shrink-0", className)} aria-hidden />;
  }

  return <Hash className={cn("size-4 shrink-0", className)} aria-hidden />;
}
