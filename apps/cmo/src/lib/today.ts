import type { CmoOverview } from "@sokosumi/core-client";
import { AGENT_NAME } from "./agent";
import {
  channelLabel,
  connectedNetworks,
  pieceMade,
  waitsForNetwork,
} from "./calendar";
import { retryWhen } from "./production";
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
 * The month as it goes out: the strategy being made, without skipped posts,
 * the posts the plan bought does not make (the Calendar's count too), and
 * posts whose day passed before they were made: they never go out.
 */
export function monthEntries(
  overview: CmoOverview,
  now: Date = new Date(),
): Entry[] {
  const strategy = overview.approvedStrategy ?? overview.strategy;
  const beyond = new Set(overview.production.beyondPlan);
  const today = now.toISOString().slice(0, 10);
  return (strategy?.calendar ?? [])
    .filter(
      (entry) =>
        entry.status !== "skipped" &&
        !beyond.has(entry.id) &&
        !(entry.status === "idea" && entry.date < today),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? "").localeCompare(b.time ?? ""),
    );
}

/**
 * The month's posts as they go out, and how many of them are made: the one
 * count Today, the Calendar, the chat and Cuso's pill all say.
 */
export function monthMade(
  overview: CmoOverview,
  now: Date = new Date(),
): {
  ready: number;
  total: number;
} {
  const posts = monthEntries(overview, now).filter((entry) => !isAd(entry));
  const media = new Set(overview.media.map((item) => item.entryId));
  return {
    ready: posts.filter((entry) => pieceMade(entry, media.has(entry.id)))
      .length,
    total: posts.length,
  };
}

/** Failed or missed its time: written, with Core's reason why it did not go out. */
function didNotGoOut(entry: Entry): boolean {
  return entry.status === "draft" && Boolean(entry.notSent);
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
  // A post a network's pause moved on is still scheduled: Core retries it,
  // nothing for the owner to do.
  const notSent = monthEntries(overview).filter(didNotGoOut);
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
    entries.filter((entry) => entry.status === status && !didNotGoOut(entry))
      .length;
  return {
    out: count("published"),
    scheduled: count("scheduled"),
    written: count("draft"),
    notSent: entries.filter(didNotGoOut).length,
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

/**
 * What Cuso says on top of the day, in one line. "Nothing needs you" only
 * once the month is made: a month that stopped half made says so.
 */
export function todayLine(overview: CmoOverview, needs: number): string {
  if (needs === 1) return "One thing needs you. The rest is on me.";
  if (needs > 1) return `${needs} things need you. The rest is on me.`;
  if (overview.botStatus === "RUNNING") {
    return `I'm on it: ${overview.activity?.step ?? "working"}.`;
  }
  const { state } = overview.production;
  const { ready, total } = monthMade(overview);
  if (state === "planning") {
    return "I'm planning your month, topic by topic. It takes a few minutes, then I make every post.";
  }
  if (state === "running" || state === "starting") {
    return `I'm making your month: ${ready} of ${total} ready.`;
  }
  if (state === "stuck") {
    const when = retryWhen(overview.production.retryAt, overview.timeZone);
    if (overview.production.writerFailed)
      return `Something on our side stopped your month at ${ready} of ${total}. We're fixing it, and I try again ${when}.`;
    return `I stopped making your month at ${ready} of ${total}. My last try made nothing new, so I try the rest again ${when}.`;
  }
  if (state === "blocked") {
    return "I couldn't start your month yet. I keep trying every ten minutes.";
  }
  return "Nothing needs you. Everything goes out on its day.";
}
