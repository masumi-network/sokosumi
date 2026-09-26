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
 * The kind glyph on its own, for a caller that already owns the box around it
 * — a sidebar row, where the box is the row's `SidebarRowSlot`.
 */
export function ChannelKindGlyph({
  discoverability,
  className,
}: {
  discoverability?: Discoverability;
  className?: string;
}) {
  const Icon = channelKindIcon(discoverability) ?? Hash;

  return (
    <Icon
      data-slot="channel-glyph"
      className={cn("size-4 shrink-0", className)}
      aria-hidden
    />
  );
}

/**
 * Slack-like: `#` for public, lock for private, globe for external/matched,
 * in a box of its own. Used where there is no sidebar row slot to sit in: the
 * room header and the Browse channels list.
 */
export function ChannelDiscoverabilityIcon({
  discoverability,
  className,
  ...props
}: ChannelDiscoverabilityIconProps) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center md:size-5 [&_svg]:size-4.5 md:[&_svg]:size-3.5",
        className,
      )}
      {...props}
      aria-hidden
    >
      {/* The box sizes the glyph, so it brings no size of its own. */}
      <ChannelKindGlyph
        discoverability={discoverability}
        className="size-auto"
      />
    </span>
  );
}
