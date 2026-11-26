import type { ScenarioCheck } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";
import {
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

/** The case whose saved posts and strategy are read after the turn. */
export const CHANGE_THEN_DRAFTS_CASE_ID = "cmo-change-then-drafts";

/** The owner asked for three draft posts: exactly three (coordinator, 2026-11-26). */
const DRAFTS_WANTED = 3;
/** A post the owner can still approve: never out, never set to go out. */
const WAITING = new Set(["DRAFT", "NEEDS_APPROVAL"]);

const COUNTS: Record<string, number> = {
  once: 1,
  one: 1,
  a: 1,
  an: 1,
  twice: 2,
  two: 2,
  thrice: 3,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};
const NUMBER =
  "(\\d+|once|one|a|an|twice|two|thrice|three|four|five|six|seven)";
const DAYS: Record<string, number> = { day: 1, week: 7, month: 365 / 12 };

function count(word: string | undefined): number | null {
  if (word === undefined) return null;
  return Number(word) || COUNTS[word] || null;
}

/**
 * Posts a week a cadence says, from an explicit quantity over an explicit
 * interval: "3x/week" is 3, "once every 7 days" 1, "twice weekly" 2, a
 * range at its top ("1-2 a week" is 2). "daily", "weekly" and "monthly"
 * alone are once per period. Anything it cannot read is null, never a guess.
 */
export function cadencePerWeek(cadence: string): number | null {
  // A time of day is no quantity ("1 a week, Tuesday 09:00").
  const text = ` ${cadence
    .toLowerCase()
    .replace(/\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b/g, " ")} `;
  // The interval in days: "every 7 days", "every other week", "/week",
  // "a week", "per day", "weekly".
  let days: number | null = null;
  let implied = false;
  const every =
    /\bevery\s+(\d+|other|two|three|four)\s+(day|week|month)s?\b/.exec(text);
  if (every?.[1] && every[2]) {
    const n = every[1] === "other" ? 2 : count(every[1]);
    if (n) days = n * (DAYS[every[2]] ?? 0);
  } else if (/\b(?:biweekly|fortnightly)\b/.test(text)) days = 14;
  else {
    const per = /(?:\/|\b(a|an|per|each|every)\s+)(day|week|month)\b/.exec(
      text,
    );
    const adjective = /\b(daily|weekly|monthly)\b/.exec(text);
    if (per?.[2]) {
      days = DAYS[per[2]] ?? null;
      // "every week" says once, as "weekly" does.
      implied = per[1] === "every";
    } else if (adjective?.[1]) {
      days =
        DAYS[adjective[1].replace(/ly$/, "").replace("dai", "day")] ?? null;
      implied = true;
    }
  }
  if (!days) return null;
  // The quantity before the interval: "3x", "3 posts", "twice", "1-2".
  const before = text.slice(
    0,
    text.search(
      /(?:\/|\bevery\b|\b(?:a|an|per|each)\s+(?:day|week|month)\b|\b(?:daily|weekly|monthly|biweekly|fortnightly)\b)/,
    ),
  );
  const quantities = [
    ...before.matchAll(new RegExp(`\\b${NUMBER}(?=\\s|x\\b|×|-|–|$)`, "g")),
  ]
    .map((match) => count(match[1]))
    .filter((value): value is number => value !== null);
  const quantity =
    quantities.length > 0
      ? Math.max(...quantities)
      : implied || every
        ? 1
        : null;
  return quantity === null ? null : (quantity * 7) / days;
}

export interface SavedPost {
  projectId: string;
  provider: string;
  status: string;
  text: string;
  scheduledAt: Date | null;
}

/**
 * What the turn saved, not what it tried. `posts` are the Cuso's own since
 * the case started: exactly three new, different X posts on his Project, each
 * still the owner's to approve (DRAFT or NEEDS_APPROVAL), none scheduled or
 * out, none on another Project, and LinkedIn saved at one post a week. A turn
 * that ended after the strategy change saved no drafts.
 */
export function changeThenDraftsChecks(input: {
  projectId: string;
  posts: readonly SavedPost[];
  linkedinCadence: string | null;
}): ScenarioCheck[] {
  const here = input.posts.filter((post) => post.projectId === input.projectId);
  const elsewhere = input.posts.length - here.length;
  const xDrafts = here.filter(
    (post) =>
      post.provider === "x" &&
      WAITING.has(post.status) &&
      post.scheduledAt === null,
  );
  const distinct = new Set(
    xDrafts
      .map((post) => post.text.replace(/\s+/g, " ").trim().toLowerCase())
      .filter(Boolean),
  );
  const going = input.posts.filter(
    (post) => !WAITING.has(post.status) || post.scheduledAt !== null,
  );
  const perWeek =
    input.linkedinCadence === null
      ? null
      : cadencePerWeek(input.linkedinCadence);
  return [
    {
      label: `Saves exactly ${DRAFTS_WANTED} new, different X drafts on his Project`,
      pass:
        here.length === DRAFTS_WANTED &&
        xDrafts.length === DRAFTS_WANTED &&
        distinct.size === DRAFTS_WANTED,
      actual: `${here.length} new post${here.length === 1 ? "" : "s"} on his Project, ${distinct.size} different X draft${distinct.size === 1 ? "" : "s"}`,
    },
    {
      label: "Writes no post to another Project",
      pass: elsewhere === 0,
      actual: `${elsewhere} elsewhere`,
    },
    {
      label: "Schedules or publishes none of them",
      pass: going.length === 0,
      actual:
        going.length === 0
          ? "all waiting for the owner"
          : going
              .map(
                (post) =>
                  `${post.provider} ${post.status}${post.scheduledAt ? " with a time" : ""}`,
              )
              .join(", "),
    },
    {
      label: "Saves LinkedIn at one post a week",
      pass: perWeek === 1,
      actual:
        input.linkedinCadence === null
          ? "no LinkedIn channel"
          : `"${input.linkedinCadence}" (${perWeek ?? "no period"} a week)`,
    },
  ];
}

export async function cmoChangeThenDraftsChecks(
  lane: EvalLaneRecord,
  startedAt: Date,
): Promise<ScenarioCheck[]> {
  const [posts, strategy] = await Promise.all([
    // Only this case's Cuso's own posts since it started, on any Project:
    // another turn's posts on the lane's Project must not count.
    prisma.socialPost.findMany({
      where: {
        createdAt: { gte: startedAt },
        creatorSokoBotId: lane.cusoBotId,
      },
      select: {
        projectId: true,
        provider: true,
        status: true,
        text: true,
        scheduledAt: true,
      },
    }),
    newestMarketingStrategy(lane.cusoProjectId),
  ]);
  const plan = parseMarketingPlan(strategy?.plan);
  const linkedin = plan?.channels.find(
    (channel) => channel.channel === "linkedin",
  );
  return changeThenDraftsChecks({
    projectId: lane.cusoProjectId,
    posts,
    linkedinCadence: linkedin?.cadence ?? null,
  });
}
