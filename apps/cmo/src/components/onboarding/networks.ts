import type { CmoOverview } from "@sokosumi/core-client";

import {
  formatDay,
  isSocialProvider,
  type SocialProvider,
} from "../../lib/calendar";
import { channelInfo, channelKey } from "../../lib/channels";

/** The social networks in the strategy, which Cuso can post to once connected. */
export function strategySocialChannels(
  overview: CmoOverview,
): SocialProvider[] {
  return [
    ...new Set(
      (overview.strategy?.channels ?? [])
        .map((channel) => channelKey(channel.channel))
        .filter(
          (key): key is NonNullable<typeof key> =>
            key !== null && channelInfo(key)?.status === "live",
        ),
    ),
  ].filter(isSocialProvider);
}

/** The Project's live social connections, by provider. */
export function connectedNetworks(overview: CmoOverview): Set<string> {
  return new Set(
    overview.channels
      .filter((channel) => channel.status.toUpperCase() === "ACTIVE")
      .map((channel) => channel.provider.toLowerCase()),
  );
}

/**
 * The next post still to come on a connected network, as "Tue 6 Oct, 09:00"
 * with its network; null when none. Calendar days and times are the founder's
 * local ones.
 */
export function firstPost(
  calendar: { date: string; time?: string; channel: string }[],
  connected: ReadonlySet<string>,
  now = new Date(),
): { when: string; channel: string } | null {
  const pad = (value: number) => String(value).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const first = calendar
    .filter(
      (entry) =>
        connected.has(channelKey(entry.channel) ?? "") &&
        (entry.date > today ||
          (entry.date === today && (entry.time ?? clock) >= clock)),
    )
    .sort((a, b) =>
      `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`),
    )[0];
  if (!first) return null;
  const day = formatDay(first.date, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return {
    when: first.time ? `${day}, ${first.time}` : day,
    channel: channelKey(first.channel) ?? first.channel,
  };
}
