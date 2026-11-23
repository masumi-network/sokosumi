import type {
  CmoCompetitors,
  CmoOverview,
  CmoPictureGroup,
  CmoSeo,
} from "@sokosumi/core-client";
import { AGENT_NAME } from "./agent";
import { connectedNetworks } from "./calendar";
import { trendLine } from "./seo-next";
import { strategyApproved } from "./strategy";
import { dayIn, monthEntries, monthProgress, waitingByNetwork } from "./today";
import type { View } from "./views";

/**
 * The head of an app page: a small grey kicker that names it, then the
 * headline that answers what the owner came for, and maybe one line more.
 */
export interface PageLeadText {
  kicker: string;
  /** Strategy leaves it out: its goal, under the lead, is the headline. */
  title?: string;
  line?: string;
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n.toLocaleString("en-US")} ${many}`;
}

/** "Monday", or "today" and "tomorrow" when the day is that close. */
export function dayName(
  at: Date | string,
  timeZone: string,
  now: Date = new Date(),
): string {
  const day = dayIn(timeZone, new Date(at));
  const today = dayIn(timeZone, now);
  const tomorrow = dayIn(timeZone, new Date(now.getTime() + 86_400_000));
  if (day === today) return "today";
  if (day === tomorrow) return "tomorrow";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      timeZone,
    }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(
      new Date(at),
    );
  }
}

function hostOf(url: string): string {
  return URL.parse(url)?.host.replace(/^www\./, "") ?? url;
}

/** "16 Nov" on Cuso's clock, or on the reader's where the page reads its own data. */
function shortDate(at: Date | string, timeZone?: string): string {
  const options = { day: "numeric", month: "short" } as const;
  try {
    return new Date(at).toLocaleDateString("en-GB", { ...options, timeZone });
  } catch {
    return new Date(at).toLocaleDateString("en-GB", options);
  }
}

function monthName(timeZone: string, now: Date): string {
  try {
    return now.toLocaleDateString("en-GB", { month: "long", timeZone });
  } catch {
    return now.toLocaleDateString("en-GB", { month: "long" });
  }
}

/** When the weekly review next reads the numbers, once the strategy runs. */
export function nextWeeklyReview(
  overview: CmoOverview,
): { at: Date | string; zone: string | null } | null {
  const review = overview.routines.find(
    (routine) => routine.key === "cmo-weekly-review",
  );
  return review?.nextRunAt && strategyApproved(overview)
    ? { at: review.nextRunAt, zone: review.timezone }
    : null;
}

function resultsTitle(overview: CmoOverview, now: Date): string {
  const out = overview.posts.published;
  const review = nextWeeklyReview(overview);
  const reported = overview.updates.some((update) => update.kind === "weekly");
  if (out > 0 && (reported || !review)) {
    return `${count(out, "post", "posts")} out so far.`;
  }
  if (review) {
    const day = dayName(review.at, review.zone ?? overview.timeZone, now);
    return `Numbers start ${day}.`;
  }
  return "Numbers start once posts go out.";
}

function calendarTitle(overview: CmoOverview): string {
  const total = monthProgress(monthEntries(overview)).total;
  if (total > 0) return `${count(total, "post", "posts")} this month.`;
  if (strategyApproved(overview)) return "Your month is being made.";
  return overview.strategy
    ? "Your month starts once you approve."
    : `${AGENT_NAME} is writing your strategy.`;
}

function channelsLead(overview: CmoOverview): PageLeadText {
  const waiting = [...waitingByNetwork(overview).values()].reduce(
    (sum, n) => sum + n,
    0,
  );
  if (waiting > 0) {
    return {
      kicker: "Channels",
      title: `${count(waiting, "post waits", "posts wait")} for you.`,
      line: "Connect the networks below and they go out on their days.",
    };
  }
  const connected = connectedNetworks(overview.channels).length;
  return connected > 0
    ? {
        kicker: "Channels",
        title: `${count(connected, "network", "networks")} connected.`,
        line: "Every post goes out on its day.",
      }
    : {
        kicker: "Channels",
        title: "Connect a network.",
        line: "I post there on your strategy's schedule.",
      };
}

/**
 * The lead of a page whose answer the overview holds. Today greets instead,
 * the chat leads with the thread itself,
 * and SEO and Competitors read their own data (`seoLead`, `competitorsLead`).
 */
export function pageLead(
  view: View,
  overview: CmoOverview,
  now: Date = new Date(),
): PageLeadText | null {
  switch (view) {
    case "calendar":
      return {
        kicker: `Calendar · ${monthName(overview.timeZone, now)}`,
        title: calendarTitle(overview),
      };
    case "results":
      return { kicker: "Results", title: resultsTitle(overview, now) };
    case "strategy": {
      const approved = overview.strategyVersion?.approvedAt;
      return {
        kicker: approved
          ? `Strategy · approved ${shortDate(approved, overview.timeZone)}`
          : "Strategy · draft",
      };
    }
    case "brain":
      return {
        kicker: `Brand Brain · what I know about ${overview.businessName}`,
        title: overview.brandBrain
          ? `Here's ${hostOf(overview.websiteUrl)} as I see it.`
          : "I'm still learning.",
        line: "Tap any line to see the source or fix it.",
      };
    case "channels":
      return channelsLead(overview);
    case "settings":
      return { kicker: "Settings", title: `Your ${AGENT_NAME}.` };
    default:
      return null;
  }
}

/** Pictures' lead: how many went on posts, from how many made. */
export function picturesLead(groups: readonly CmoPictureGroup[]): PageLeadText {
  const made = groups.reduce(
    (sum, group) => sum + group.alternatives.length,
    0,
  );
  const posted = groups.filter((group) =>
    group.alternatives.some((alternative) => alternative.chosen),
  ).length;
  if (groups.length === 0)
    return { kicker: "Settings · Pictures", title: "No pictures yet." };
  return {
    kicker: "Settings · Pictures",
    title: `${count(posted, "picture", "pictures")} on your posts.`,
    line: `I made ${count(made, "picture", "pictures")} to choose them: the one on each post, and beside it the ones I left out and why.`,
  };
}

/** SEO's lead: clicks from Google and their trend; without Search Console, what the audit says to change. */
export function seoLead(
  seo: CmoSeo,
  timeZone: string,
  now: Date = new Date(),
): PageLeadText {
  const latest = seo.audit.latest;
  const { totals, previousTotals } = seo.searchConsole;
  if (totals)
    return {
      kicker: `SEO · ${hostOf(seo.websiteUrl)} on Google`,
      title: `${count(totals.clicks, "click", "clicks")} from Google.`,
      line: trendLine(totals, previousTotals),
    };
  const kicker = latest
    ? `SEO · audit of ${hostOf(seo.websiteUrl)}, ${shortDate(latest.observedAt)}`
    : "SEO";
  const open = seo.pageChanges.filter((change) => change.status === "open");
  if (open.length > 0) {
    return {
      kicker,
      title: `${count(open.length, "change", "changes")} to make.`,
      line: `${latest ? `${latest.passed} of ${latest.checked} checks passed. ` : ""}${open.length === 1 ? "The change below comes" : "Each change below comes"} with the exact new text to copy.`,
    };
  }
  if (latest) {
    return {
      kicker,
      title: "Nothing to change.",
      line: `${latest.passed} of ${latest.checked} checks passed.`,
    };
  }
  const next = seo.audit.nextRunAt;
  return {
    kicker,
    title: next
      ? `First audit ${dayName(next, timeZone, now)}.`
      : "No audit yet.",
    line: "Once a week I check your site and say what to change.",
  };
}

/** Competitors' lead: what moved in the week the last check read. */
export function competitorsLead(data: CmoCompetitors): PageLeadText {
  const { feed } = data;
  const kicker = feed
    ? `Competitors · checked ${shortDate(feed.checkDay, "UTC")}`
    : "Competitors";
  if (data.competitors.length === 0) {
    return {
      kicker,
      title: "Nobody watched yet.",
      line: "Add a competitor and I check it within the hour.",
    };
  }
  if (!feed) {
    return {
      kicker,
      title: data.check.lastCheckedAt
        ? "Reading this week's check."
        : "First check within the hour.",
      line: `I watch ${count(data.competitors.length, "competitor", "competitors")} and tell you what moved, with the source.`,
    };
  }
  const big = feed.items.filter((item) => item.big).length;
  const moves = feed.items.length;
  const title =
    moves === 0
      ? "A quiet week."
      : big === 1
        ? "One big move this week."
        : big > 1
          ? `${big} big moves this week.`
          : moves === 1
            ? "One move this week."
            : `${moves} moves this week.`;
  return { kicker, title };
}
