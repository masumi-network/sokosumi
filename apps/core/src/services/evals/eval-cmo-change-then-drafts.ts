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
  twice: 2,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};
/** Weeks in each period a cadence names. */
const PER_WEEK: [RegExp, number][] = [
  [/\b(?:every other week|biweekly|fortnightly)\b/, 0.5],
  [/\b(?:day|days|daily)\b/, 7],
  [/\b(?:week|weeks|weekly)\b/, 1],
  [/\b(?:month|months|monthly)\b/, 12 / 52],
];

/**
 * Posts a week a cadence says, from its quantity and its period ("twice
 * weekly" is 2, "3 posts a week" 3, "weekly" 1); a range counts at its top.
 * Null when it names no period.
 */
export function cadencePerWeek(cadence: string): number | null {
  // A time of day is no quantity ("1 a week, Tuesday 09:00").
  const text = cadence
    .toLowerCase()
    .replace(/\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b/g, " ");
  const period = PER_WEEK.find(([pattern]) => pattern.test(text));
  if (!period) return null;
  if (period[1] === 0.5) return 0.5;
  const numbers = [
    ...text.matchAll(/\b(\d+|once|one|twice|two|three|four|five|six|seven)\b/g),
  ].map((match) => Number(match[1]) || COUNTS[match[1] ?? ""] || 0);
  const quantity = numbers.length > 0 ? Math.max(...numbers) : 1;
  return quantity * period[1];
}

export interface SavedPost {
  projectId: string;
  provider: string;
  status: string;
  text: string;
  scheduledAt: Date | null;
}

/**
 * What the turn saved, not what it tried: exactly three new, different X
 * posts on the Cuso's own Project, each still the owner's to approve (DRAFT
 * or NEEDS_APPROVAL), none scheduled or out and none elsewhere, and LinkedIn
 * saved at one post a week. A turn that ended after the strategy change saved
 * no drafts.
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
      label: `Saves exactly ${DRAFTS_WANTED} new, different X drafts on his Project and nothing else`,
      pass:
        here.length === DRAFTS_WANTED &&
        xDrafts.length === DRAFTS_WANTED &&
        distinct.size === DRAFTS_WANTED &&
        elsewhere === 0,
      actual: `${here.length} new post${here.length === 1 ? "" : "s"} on his Project, ${distinct.size} different X draft${distinct.size === 1 ? "" : "s"}, ${elsewhere} elsewhere`,
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
    // New posts on his Project by anyone, and his own anywhere else.
    prisma.socialPost.findMany({
      where: {
        createdAt: { gte: startedAt },
        OR: [
          { projectId: lane.cusoProjectId },
          { creatorSokoBotId: lane.cusoBotId },
        ],
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
