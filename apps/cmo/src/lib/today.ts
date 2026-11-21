import type { CmoOverview } from "@sokosumi/core-client";
import { AGENT_NAME } from "./agent";
import { channelLabel, connectedNetworks, waitsForNetwork } from "./calendar";
import { isAd, strategyApproved } from "./strategy";
import type { View } from "./views";

type Entry = NonNullable<CmoOverview["strategy"]>["calendar"][number];

/** One thing only the owner can do, and the page where they do it. */
export interface NeedsYou {
  id: string;
  title: string;
  detail: string;
  action: string;
  view: View;
  /** The post the action opens on the Calendar, when it is about one. */
  entryId?: string;
}

/**
 * The month as it goes out: the strategy being made, without skipped posts
 * and the posts the plan bought does not make (the Calendar's count too).
 */
export function monthEntries(overview: CmoOverview): Entry[] {
  const strategy = overview.approvedStrategy ?? overview.strategy;
  const beyond = new Set(overview.production.beyondPlan);
  return (strategy?.calendar ?? [])
    .filter((entry) => entry.status !== "skipped" && !beyond.has(entry.id))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? "").localeCompare(b.time ?? ""),
    );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** "X, LinkedIn and Facebook". */
function listed(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Everything waiting on the owner, most urgent first: Cuso stopped, a
 * strategy to approve, posts to approve, the networks posts wait for (one
 * row for all of them).
 */
export function needsYou(overview: CmoOverview): NeedsYou[] {
  const items: NeedsYou[] = [];
  const approved = strategyApproved(overview);
  if (approved && overview.billing.availableCredits <= 0) {
    items.push({
      id: "credits",
      title: `${AGENT_NAME} is out of credits`,
      detail: "Scheduled work waits until you top up.",
      action: "Top up",
      view: "settings",
    });
  }
  if (overview.learning === "failed") {
    items.push({
      id: "learning",
      title: `${AGENT_NAME} could not read your site`,
      detail: "Tell him where to look, or try again.",
      action: `Open ${AGENT_NAME}`,
      view: "chat",
    });
  }
  if (overview.strategy && !approved && overview.viewerCanApprove) {
    items.push({
      id: "strategy",
      title: "Your strategy is ready",
      detail: "Approve it and he makes the month.",
      action: "Review strategy",
      view: "strategy",
    });
  }
  const drafts = overview.drafts.filter(
    (draft) => draft.status === "NEEDS_APPROVAL",
  );
  if (drafts.length > 0) {
    items.push({
      id: "drafts",
      title: `${plural(drafts.length, "post waits", "posts wait")} for your OK`,
      detail: "Nothing goes out until you approve.",
      action: drafts.length === 1 ? "Review post" : "Review posts",
      view: "calendar",
    });
  }
  const notSent = monthEntries(overview).filter((entry) => entry.notSent);
  const [first] = notSent;
  if (first?.notSent) {
    items.push({
      id: "not-sent",
      title: `${plural(notSent.length, "post", "posts")} didn't go out`,
      detail: first.notSent,
      action: notSent.length === 1 ? "See post" : "See the first",
      view: "calendar",
      entryId: first.id,
    });
  }
  const waiting = waitingByNetwork(overview);
  if (waiting.size > 0) {
    const names = [...waiting.keys()].map(channelLabel);
    const count = [...waiting.values()].reduce((sum, n) => sum + n, 0);
    const one = waiting.size === 1;
    items.push({
      id: "connect",
      title: `Connect ${listed(names)}`,
      detail: `${plural(count, "post is", "posts are")} written and ${count === 1 ? "waits" : "wait"} for ${one ? "it" : "them"}.`,
      action: one ? `Connect ${names[0]}` : "Open Channels",
      view: "channels",
    });
  }
  return items;
}

/** The month's written posts that wait for a network, counted per network. */
export function waitingByNetwork(overview: CmoOverview): Map<string, number> {
  const connected = connectedNetworks(overview.channels);
  const waiting = new Map<string, number>();
  for (const entry of monthEntries(overview)) {
    const network = waitsForNetwork(entry, connected);
    if (network) waiting.set(network, (waiting.get(network) ?? 0) + 1);
  }
  return waiting;
}

/** "27 posts wait for YouTube, Instagram and TikTok.", or null when none wait. */
export function waitingLine(overview: CmoOverview): string | null {
  const waiting = waitingByNetwork(overview);
  if (waiting.size === 0) return null;
  const count = [...waiting.values()].reduce((sum, n) => sum + n, 0);
  const names = listed([...waiting.keys()].map(channelLabel));
  return `${plural(count, "post waits", "posts wait")} for ${names}.`;
}

/** The owner's day (YYYY-MM-DD) in Cuso's time zone. */
export function dayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return now.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The Monday-first week holding `day`. */
export function weekOf(day: string): string[] {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(date);
    next.setUTCDate(date.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

/** How far the month is, in the four places a post can stand. */
export interface MonthProgress {
  out: number;
  scheduled: number;
  written: number;
  /** Failed or missed its time. */
  notSent: number;
  planned: number;
  total: number;
}

export function monthProgress(month: Entry[]): MonthProgress {
  // Ads are launched by the owner and never go out as posts.
  const entries = month.filter((entry) => !isAd(entry));
  const count = (status: Entry["status"]) =>
    entries.filter((entry) => entry.status === status && !entry.notSent).length;
  return {
    out: count("published"),
    scheduled: count("scheduled"),
    written: count("draft"),
    notSent: entries.filter((entry) => entry.notSent).length,
    planned: count("idea"),
    total: entries.length,
  };
}

/** "Good morning" by the hour in Cuso's time zone (the owner's, set at hire or in Settings). */
export function greeting(timeZone: string, now: Date = new Date()): string {
  let hour = now.getUTCHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone,
      }).format(now),
    );
  } catch {}
  // Past midnight, "Good evening" reads wrong and "Good night" is a goodbye.
  if (hour < 5) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
