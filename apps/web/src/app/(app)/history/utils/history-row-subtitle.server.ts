import "server-only";

import { slugify } from "@/app/chat/utils/bucket-slug";
import {
  createEmptyHistorySubtitleLookups,
  type HistorySubtitleLookups,
} from "@/app/history/utils/history-row-subtitle";
import prisma from "@/lib/db/prisma";
import { getAgentName } from "@/lib/helpers/agent";
import { coworkerService } from "@/lib/services/coworker.service";
import type { HistoryItem } from "@/lib/services/history.service";

export async function buildHistorySubtitleLookups(
  history: HistoryItem[],
): Promise<HistorySubtitleLookups> {
  const agentIds = getUniqueAgentIds(history);
  const bucketSlugs = getUniqueBucketSlugs(history);

  if (agentIds.length === 0 && bucketSlugs.length === 0) {
    return createEmptyHistorySubtitleLookups();
  }

  const [agentNameById, bucketDisplayNameBySlug] = await Promise.all([
    buildAgentNameLookup(agentIds),
    buildBucketDisplayNameLookup(bucketSlugs),
  ]);

  return {
    agentNameById,
    bucketDisplayNameBySlug,
  };
}

function getUniqueAgentIds(history: HistoryItem[]): string[] {
  return [
    ...new Set(
      history.filter((item) => item.kind === "job").map((item) => item.agentId),
    ),
  ];
}

function getUniqueBucketSlugs(history: HistoryItem[]): string[] {
  return [
    ...new Set(
      history.flatMap((item) =>
        item.kind === "conversation" && item.bucketSlug
          ? [item.bucketSlug]
          : [],
      ),
    ),
  ];
}

async function buildAgentNameLookup(
  agentIds: string[],
): Promise<Record<string, string>> {
  if (agentIds.length === 0) return {};

  const agents = await prisma.agent
    .findMany({
      where: {
        id: {
          in: agentIds,
        },
      },
      select: {
        id: true,
        name: true,
        overrideName: true,
      },
    })
    .catch(() => []);

  return Object.fromEntries(
    agents.map((agent) => [
      agent.id,
      getAgentName(agent as Parameters<typeof getAgentName>[0]),
    ]),
  );
}

async function buildBucketDisplayNameLookup(
  bucketSlugs: string[],
): Promise<Record<string, string>> {
  if (bucketSlugs.length === 0) return {};

  const coworkers = await coworkerService.listCoworkers().catch(() => []);
  const coworkerNameBySlug = new Map<string, string>();

  for (const coworker of coworkers) {
    coworkerNameBySlug.set(slugify(coworker.slug), coworker.name);
    coworkerNameBySlug.set(slugify(coworker.name), coworker.name);
  }

  return Object.fromEntries(
    bucketSlugs.map((bucketSlug) => [
      bucketSlug,
      coworkerNameBySlug.get(slugify(bucketSlug)) ?? humanizeSlug(bucketSlug),
    ]),
  );
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
