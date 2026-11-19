import type { CmoOverview } from "@sokosumi/core-client";

import { calendarKind } from "../lib/calendar";
import { channelKey } from "../lib/channels";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

export type ShowcaseKind =
  | "x"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "ad"
  | "google"
  | "newsletter"
  | "seo";

export function showcaseKind(
  entry: Pick<Entry, "channel" | "format">,
): ShowcaseKind | null {
  const channel = channelKey(entry.channel) ?? entry.channel.toLowerCase();
  if (channel === "google_ads" && entry.format !== "display_ad")
    return "google";
  const kind = calendarKind(entry);
  if (kind === "ad") return "ad";
  if (kind === "news") return "newsletter";
  if (kind === "article") return "seo";
  if (channel === "x" || channel === "twitter") return "x";
  if (channel === "linkedin") return "linkedin";
  if (channel === "instagram") return "instagram";
  if (channel === "facebook") return "facebook";
  return null;
}

/** The plan's pieces per showcase, earliest first, written drafts before ideas. */
export function showcaseEntries(
  strategy: Strategy,
): Map<ShowcaseKind, Entry[]> {
  const groups = new Map<ShowcaseKind, Entry[]>();
  const sorted = [...strategy.calendar].sort(
    (a, b) =>
      Number(Boolean(b.draft)) - Number(Boolean(a.draft)) ||
      `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`),
  );
  for (const entry of sorted) {
    const kind = showcaseKind(entry);
    if (kind) groups.set(kind, [...(groups.get(kind) ?? []), entry]);
  }
  return groups;
}

/** "Subject: …", also as "**Subject:** …" or "# Subject: …". */
const LABELED_LINE =
  /^[#*\s]*(?:subject(?: line)?|headline|title)\**\s*:\s*\**\s*(.+?)\**\s*$/im;

/** "Subject: Launch day" → "Launch day"; other text as it is. */
export function withoutLabel(value: string): string {
  return LABELED_LINE.exec(value)?.[1]?.trim() ?? value;
}
