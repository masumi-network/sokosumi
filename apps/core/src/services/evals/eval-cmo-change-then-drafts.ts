import type { ScenarioCheck } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";
import {
  newestMarketingStrategy,
  parseMarketingPlan,
} from "@/services/marketing-strategy.service";

/** The case whose saved posts and strategy are read after the turn. */
export const CHANGE_THEN_DRAFTS_CASE_ID = "cmo-change-then-drafts";

const DRAFTS_WANTED = 3;
/** A post still waiting for the owner: never out, never set to go out. */
const WAITING = new Set(["DRAFT", "NEEDS_APPROVAL"]);
const WEEKLY =
  /\b(?:once|one|1)\s*(?:post\s+)?(?:a|per|each|every|\/)\s*week\b|\bweekly\b/i;

export interface SavedPost {
  provider: string;
  status: string;
  text: string;
  scheduledAt: Date | null;
}

/**
 * What the turn saved, not what it tried: three different X drafts on the
 * Cuso's own Project, none scheduled or out, and LinkedIn saved as weekly.
 * A turn that ended after the strategy change saved no drafts.
 */
export function changeThenDraftsChecks(input: {
  posts: readonly SavedPost[];
  linkedinCadence: string | null;
}): ScenarioCheck[] {
  const distinct = new Set(
    input.posts
      .filter(
        (post) =>
          post.provider === "x" &&
          WAITING.has(post.status) &&
          post.scheduledAt === null,
      )
      .map((post) => post.text.replace(/\s+/g, " ").trim().toLowerCase())
      .filter(Boolean),
  );
  const going = input.posts.filter(
    (post) => !WAITING.has(post.status) || post.scheduledAt !== null,
  );
  return [
    {
      label: `Saves ${DRAFTS_WANTED} different X drafts on his Project`,
      pass: distinct.size >= DRAFTS_WANTED,
      actual: `${distinct.size} different X draft${distinct.size === 1 ? "" : "s"} of ${input.posts.length} posts`,
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
      label: "Saves LinkedIn at once a week",
      pass:
        input.linkedinCadence !== null && WEEKLY.test(input.linkedinCadence),
      actual: input.linkedinCadence ?? "no LinkedIn channel",
    },
  ];
}

export async function cmoChangeThenDraftsChecks(
  lane: EvalLaneRecord,
  startedAt: Date,
): Promise<ScenarioCheck[]> {
  const [posts, strategy] = await Promise.all([
    prisma.socialPost.findMany({
      where: {
        projectId: lane.cusoProjectId,
        creatorSokoBotId: lane.cusoBotId,
        createdAt: { gte: startedAt },
      },
      select: { provider: true, status: true, text: true, scheduledAt: true },
    }),
    newestMarketingStrategy(lane.cusoProjectId),
  ]);
  const plan = parseMarketingPlan(strategy?.plan);
  const linkedin = plan?.channels.find(
    (channel) => channel.channel === "linkedin",
  );
  return changeThenDraftsChecks({
    posts,
    linkedinCadence: linkedin?.cadence ?? null,
  });
}
