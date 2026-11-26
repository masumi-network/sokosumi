import type { ScenarioCheck } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { cmoLastWeek } from "@/services/cmo-context.service";
import type { EvalLaneRecord } from "./eval-lanes.service";

export const CMO_WEEKLY_REVIEW_CASE_ID = "cmo-weekly-review-last-week";

const DAY_MS = 86_400_000;

/**
 * cal.com's approved month with three X posts that went out last week and
 * four drafts dated next month, as entry.fyi's review of 23 November saw it.
 */
export async function prepareCmoWeeklyReview(
  lane: EvalLaneRecord,
  now: Date = new Date(),
): Promise<void> {
  const projectId = lane.cusoProjectId;
  const newest = await prisma.marketingStrategy.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!newest) throw new Error("The weekly review case needs cal.com's month");
  await prisma.marketingStrategy.update({
    where: { id: newest.id },
    data: { approvedAt: new Date(now.getTime() - 10 * DAY_MS) },
  });
  await prisma.socialComment.deleteMany({ where: { projectId } });
  await prisma.socialPost.deleteMany({ where: { projectId } });
  const base = {
    projectId,
    workspaceId: lane.workspaceId,
    creatorSokoBotId: lane.cusoBotId,
    provider: "x" as const,
  };
  const published = [
    [2, "Round-robin booking is live for every Teams plan.", 1_840, 22],
    [4, "One link, every calendar: how Cal.com routes a demo request.", 960, 9],
    [6, "Mintlify halved the time it takes to find a meeting slot.", 2_310, 31],
  ] as const;
  for (const [daysAgo, text, impressions, likes] of published) {
    const at = new Date(now.getTime() - daysAgo * DAY_MS);
    // As X's statistics left them this morning, so the review needs no refresh.
    const fetchedAt = new Date(now.getTime() - 3 * 60 * 60_000).toISOString();
    await prisma.socialPost.create({
      data: {
        ...base,
        text,
        status: "PUBLISHED",
        scheduledAt: at,
        publishedAt: at,
        publishedUrl: `https://x.com/calcom/status/eval${daysAgo}`,
        publishedExternalId: `eval${daysAgo}`,
        statistics: {
          metrics: {
            views: null,
            impressions,
            likes,
            comments: 1,
            shares: null,
            saves: null,
          },
          fetchedAt,
          refreshAttemptedAt: fetchedAt,
          error: null,
        },
      },
    });
  }
  for (const daysAhead of [18, 20, 22, 24])
    await prisma.socialPost.create({
      data: {
        ...base,
        text: `December idea ${daysAhead}: a scheduling tip for the holidays.`,
        status: "DRAFT",
        scheduledAt: new Date(now.getTime() + daysAhead * DAY_MS),
      },
    });
}

/**
 * Every statistics call asks for last week, and the answer does not blame
 * a connection for the numbers next month's drafts cannot have.
 */
export function weeklyReviewChecks(
  toolCalls: readonly { capability: string; input: unknown }[],
  answer: string,
  startedAt: Date,
): ScenarioCheck[] {
  const week = cmoLastWeek(startedAt);
  const earliest = new Date(`${week.from}T00:00:00Z`).getTime() - DAY_MS;
  const latest = new Date(`${week.until}T00:00:00Z`).getTime() + DAY_MS;
  const ranges = toolCalls
    .filter((call) => call.capability === "list_social_post_statistics")
    .map(
      (call) =>
        call.input as { publishedFrom?: string; publishedUntil?: string },
    );
  const outside = ranges.filter(
    (range) =>
      (range.publishedFrom &&
        new Date(range.publishedFrom).getTime() < earliest) ||
      (range.publishedUntil &&
        new Date(range.publishedUntil).getTime() > latest) ||
      (!range.publishedFrom && !range.publishedUntil),
  );
  return [
    {
      label: `Asks for statistics of last week only (${week.from} to ${week.to})`,
      pass: ranges.length > 0 && outside.length === 0,
      actual: ranges.length
        ? ranges
            .map(
              (range) =>
                `${range.publishedFrom ?? "any"}..${range.publishedUntil ?? "any"}`,
            )
            .join(", ")
        : "never called list_social_post_statistics",
    },
    {
      label: "Does not tell the owner last week has no numbers",
      pass: !/no (?:numbers|data|statistics)|nothing (?:was )?(?:published|posted)/i.test(
        answer,
      ),
      actual: answer.slice(0, 160),
    },
  ];
}
