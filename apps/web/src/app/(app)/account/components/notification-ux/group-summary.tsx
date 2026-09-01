"use client";

import { BellRing, type LucideIcon, Mail, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type CategoryGroup,
  DISPLAY_CHANNELS,
  type DisplayChannel,
  deliveryChannels,
  headline,
} from "./notification-model";

export const CHANNEL_ICON: Record<DisplayChannel, LucideIcon> = {
  IN_APP: BellRing,
  OS_BANNER: Smartphone,
  EMAIL: Mail,
};

export const CHANNEL_LABEL: Record<DisplayChannel, string> = {
  IN_APP: "In Sokosumi",
  OS_BANNER: "Banner",
  EMAIL: "Email",
};

/**
 * How much of a channel this group uses.
 *
 * Only the subjects the summary names are counted. A covered subject would say
 * "banner" a second time for the same message, and a state built from that
 * would report a mixture where the reader sees one setting.
 */
export function channelState(
  group: CategoryGroup,
  channel: DisplayChannel,
): "on" | "mixed" | "off" {
  const named = headline(group);
  const reached = named.filter((subject) =>
    deliveryChannels(subject.effective).includes(channel),
  );

  if (reached.length === 0) {
    return "off";
  }

  return reached.length === named.length ? "on" : "mixed";
}

/**
 * One pip per subject, filled when that subject arrives.
 *
 * The closed row can name two subjects at most, so the pips carry the rest:
 * four things can happen in Chat and two of them reach you. It says how much of
 * the group is live without listing what a reader turned off on purpose.
 */
export function SubjectPips({
  group,
  className,
}: {
  group: CategoryGroup;
  className?: string;
}) {
  if (group.subjects.length < 2) {
    return null;
  }

  return (
    <span className={cn("flex items-center gap-1", className)} aria-hidden>
      {group.subjects.map((subject) => (
        <span
          key={subject.spec.id}
          className={cn(
            "h-1.5 w-4 rounded-full transition-colors",
            subject.effective === "OFF"
              ? "bg-muted-foreground/20"
              : "bg-primary/60",
          )}
        />
      ))}
    </span>
  );
}

/**
 * Which channels this group reaches, as icons. Read only: it reports, and the
 * control next to it decides.
 */
export function ChannelSummary({ group }: { group: CategoryGroup }) {
  return (
    <span className="flex items-center gap-1.5">
      {DISPLAY_CHANNELS.map((channel) => {
        const Icon = CHANNEL_ICON[channel];
        const state = channelState(group, channel);

        return (
          <Icon
            key={channel}
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              state === "on" && "text-primary",
              state === "mixed" && "text-primary/50",
              state === "off" && "text-muted-foreground/30",
            )}
          />
        );
      })}
    </span>
  );
}

/**
 * Breadth and delivery in one glance: how much of the group is live, then where
 * it lands. The two things a closed group has to say without being opened.
 */
export function GroupGlance({ group }: { group: CategoryGroup }) {
  return (
    <span className="flex shrink-0 items-center gap-3" aria-hidden>
      <SubjectPips group={group} />
      <ChannelSummary group={group} />
    </span>
  );
}
