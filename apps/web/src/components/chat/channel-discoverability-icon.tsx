import { Globe2, Hash, Lock } from "lucide-react";
import type { ComponentProps } from "react";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

type Discoverability = ChatRoom["discoverability"];

interface ChannelDiscoverabilityIconProps extends ComponentProps<"span"> {
  discoverability?: Discoverability;
}

/**
 * The icon a non-public kind carries: lock for private, globe for external
 * and matched. Null for public, whose only mark is the `#` glyph itself.
 */
export function channelKindIcon(discoverability?: Discoverability) {
  if (discoverability === "private") return Lock;
  if (discoverability === "external" || discoverability === "matched") {
    return Globe2;
  }
  return null;
}

/**
 * Slack-like: `#` for public, lock for private, globe for external/matched.
 * The outer box matches DM avatars so every room row shares one leading column:
 * 28px below `md`, where the row is 44px tall and a 20px mark left it looking
 * empty, and 20px from `md` up. The wrapper blocks the sidebar's
 * `[&>svg]:size-4` override.
 */
export function ChannelDiscoverabilityIcon({
  discoverability,
  className,
  ...props
}: ChannelDiscoverabilityIconProps) {
  const Icon = channelKindIcon(discoverability) ?? Hash;

  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center md:size-5 [&_svg]:size-4.5 md:[&_svg]:size-3.5",
        className,
      )}
      {...props}
      aria-hidden
    >
      <Icon />
    </span>
  );
}
