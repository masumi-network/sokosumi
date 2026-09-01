"use client";

import { cn } from "@/lib/utils";
import { CHANNEL_ICON } from "./channel-chip";
import { type CategoryGroup, LEVEL_COPY } from "./notification-model";
import { type NotificationChoices } from "./use-notification-choices";

/** The channels this account can actually store, in reading order. */
export function storedChannels(group: CategoryGroup) {
  return (group.categories[0]?.channels ?? []).filter(
    (channel) => channel.available,
  );
}

/** What the group listens for: the top rung speaks for every rung under it. */
export function scopeLine(group: CategoryGroup, choices: NotificationChoices) {
  return group.rungs[choices.groupScope(group)]?.summary ?? group.description;
}

/** Where it arrives, in the words the delivery control uses. */
export function deliveryLine(
  group: CategoryGroup,
  choices: NotificationChoices,
) {
  const level = choices.groupLevel(group);

  if (level !== "CUSTOM") {
    return LEVEL_COPY[level].sentence;
  }

  const reached = storedChannels(group)
    .map((channel) => {
      const state = choices.groupChannelState(group, channel.channel);

      if (state === "off") {
        return null;
      }

      return state === "mixed" ? `${channel.label} (some)` : channel.label;
    })
    .filter((part) => part !== null);

  return reached.length === 0 ? LEVEL_COPY.OFF.sentence : reached.join(", ");
}

/**
 * The whole group in one sentence.
 *
 * Two halves, always in the same order: what it listens for, then where that
 * lands. An off group drops the first half, because what it listens for stops
 * being the reader's problem the moment nothing arrives.
 */
export function summaryLine(
  group: CategoryGroup,
  choices: NotificationChoices,
) {
  const level = choices.groupLevel(group);

  if (level === "OFF") {
    return LEVEL_COPY.OFF.sentence;
  }

  return `${scopeLine(group, choices)} · ${deliveryLine(group, choices)}`;
}

/**
 * How far up the ladder this group reaches, as filled pips.
 *
 * The ladder is ordered and containing, and a row of pips is the one shape that
 * says both without words: four pips, three filled, and the fourth is something
 * you are not being told about.
 */
export function ScopeMeter({
  group,
  choices,
  className,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  className?: string;
}) {
  const reach = choices.groupScope(group);
  const silent = choices.groupLevel(group) === "OFF";

  if (group.rungs.length < 2) {
    return null;
  }

  return (
    <span
      className={cn("flex items-center gap-1", className)}
      title={scopeLine(group, choices)}
    >
      <span className="sr-only">{scopeLine(group, choices)}</span>
      {group.rungs.map((rung, index) => (
        <span
          key={rung.id}
          aria-hidden
          className={cn(
            "h-1.5 w-4 rounded-full transition-colors",
            index > reach || silent
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
export function ChannelSummary({
  group,
  choices,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="sr-only">{deliveryLine(group, choices)}</span>
      {storedChannels(group).map((channel) => {
        const Icon = CHANNEL_ICON[channel.channel];
        const state = choices.groupChannelState(group, channel.channel);

        return (
          <Icon
            key={channel.channel}
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
 * Breadth and delivery in one glance: how far the ladder goes, then where it
 * lands. The two things a closed group has to say without being opened.
 */
export function GroupGlance({
  group,
  choices,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
}) {
  return (
    <span className="flex shrink-0 items-center gap-3">
      <ScopeMeter group={group} choices={choices} />
      <ChannelSummary group={group} choices={choices} />
    </span>
  );
}
