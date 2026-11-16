import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";

/**
 * Eval lanes run on mainnet, so what an eval bot does must stay inside its
 * eval organization. Two rules hold that line:
 *
 * - Global (whitelisted) Coworkers are not offered to it, and it cannot
 *   assign or ask them: they would do real, paid work on an eval Task.
 * - Tools that reach people or money outside Sokosumi answer as if they
 *   worked, without running: a hire, a subscriber's confirmation email, a
 *   published post, an ad. The tool call is still recorded, so a case can
 *   check the bot did, or did not, try.
 */

/** Social connections the eval world seeds: no Composio account behind them. */
export const EVAL_CONNECTED_ACCOUNT_PREFIX = "eval:";

const CACHE_MS = 60_000;
let cache: {
  at: number;
  workspaceIds: Set<string>;
  cusoProjectIds: Set<string>;
} | null = null;

async function evalLanes(): Promise<NonNullable<typeof cache> | null> {
  // A Prisma double without the eval tables (unit tests) has no lanes.
  if (typeof prisma.evalLane?.findMany !== "function") return null;
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const lanes = await prisma.evalLane.findMany({
      select: { workspaceId: true, cusoProjectId: true },
    });
    cache = {
      at: Date.now(),
      workspaceIds: new Set(lanes.map((lane) => lane.workspaceId)),
      cusoProjectIds: new Set(
        lanes.flatMap((lane) =>
          lane.cusoProjectId ? [lane.cusoProjectId] : [],
        ),
      ),
    };
  }
  return cache;
}

export async function isEvalWorkspace(workspaceId: string): Promise<boolean> {
  return (await evalLanes())?.workspaceIds.has(workspaceId) ?? false;
}

/**
 * An eval lane's Cuso stands in for a paying customer: the CMO subscription
 * gate lets him work on the lane's credits (ADR 0068).
 */
export async function isEvalCusoProject(projectId: string): Promise<boolean> {
  return (await evalLanes())?.cusoProjectIds.has(projectId) ?? false;
}

/** A lane created a moment ago must count at once. */
export function forgetEvalWorkspaces(): void {
  cache = null;
}

/** `{ isWhitelisted: true }` where a bot may see global Coworkers; none in an eval workspace. */
export async function globalCoworkersFor(
  workspaceId: string,
): Promise<Prisma.CoworkerWhereInput[]> {
  return (await isEvalWorkspace(workspaceId)) ? [] : [{ isWhitelisted: true }];
}

const SIMULATED: Record<string, (input: unknown) => Record<string, unknown>> = {
  hire_agent: () => ({
    executed: true,
    status: "ACCEPTED",
    decisionId: null,
    resultingEntityId: null,
  }),
  provide_job_input: () => ({ executed: true, status: "ACCEPTED" }),
  add_newsletter_subscriber: () => ({ added: 1 }),
  import_newsletter_subscribers: () => ({ added: 0, skipped: 0 }),
  add_newsletter_subscribers_from_contacts: () => ({ added: 0, skipped: 0 }),
  publish_social_post: () => ({ status: "PUBLISHED" }),
  create_ad_campaign: () => ({ status: "PAUSED", campaignId: null }),
  update_ad_campaign: () => ({ updated: true }),
  edit_ad_campaign: () => ({ updated: true }),
  delete_ad_campaign: () => ({ deleted: true }),
  handle_social_comment: () => ({ handled: true }),
};

/** What a tool answers in an eval workspace instead of running; null runs it. */
export function simulatedEvalTool(
  capability: string,
  input: unknown,
): Record<string, unknown> | null {
  const simulate = SIMULATED[capability];
  return simulate ? simulate(input) : null;
}

function coworkerIdsIn(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const { coworkerId, coworkerIds } = input as {
    coworkerId?: unknown;
    coworkerIds?: unknown;
  };
  return [
    ...(typeof coworkerId === "string" ? [coworkerId] : []),
    ...(Array.isArray(coworkerIds)
      ? coworkerIds.filter((id): id is string => typeof id === "string")
      : []),
  ];
}

/** A refusal when an eval bot names a Coworker that is not its workspace's own. */
export async function evalCoworkerRefusal(
  workspaceId: string,
  input: unknown,
): Promise<string | null> {
  const ids = coworkerIdsIn(input);
  if (ids.length === 0) return null;
  const own = await prisma.coworker.count({
    where: {
      id: { in: ids },
      workspaceAccess: { some: { workspaceId, status: "GRANTED" } },
    },
  });
  return own === new Set(ids).size
    ? null
    : "That Coworker is not available in this workspace; pick one from find_coworkers.";
}
