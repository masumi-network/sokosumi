import "server-only";

import { CHAT_MODELS } from "@sokosumi/chat";

import { slugify } from "@/app/chat/utils/bucket-slug";
import {
  createEmptyHistorySubtitleLookups,
  type HistoryBucketIconPreview,
  type HistorySubtitleLookups,
} from "@/app/history/utils/history-row-subtitle";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import prisma from "@/lib/db/prisma";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { coworkerService } from "@/lib/services/coworker.service";
import type { HistoryItem } from "@/lib/services/history.service";

interface BucketLookup {
  bucketDisplayNameBySlug: Record<string, string>;
  bucketIconBySlug: Record<string, HistoryBucketIconPreview>;
}

export async function buildHistorySubtitleLookups(
  history: HistoryItem[],
): Promise<HistorySubtitleLookups> {
  const agentIds = getUniqueAgentIds(history);
  const bucketSlugs = getUniqueBucketSlugs(history);

  if (agentIds.length === 0 && bucketSlugs.length === 0) {
    return createEmptyHistorySubtitleLookups();
  }

  const [agentPreviewById, bucketLookup] = await Promise.all([
    buildAgentPreviewLookup(agentIds),
    buildBucketLookup(bucketSlugs),
  ]);

  return {
    agentPreviewById,
    ...bucketLookup,
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

async function buildAgentPreviewLookup(
  agentIds: string[],
): Promise<HistorySubtitleLookups["agentPreviewById"]> {
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
        icon: true,
      },
    })
    .catch(() => []);

  return Object.fromEntries(
    agents.map((agent) => {
      const name = getAgentName(agent as Parameters<typeof getAgentName>[0]);
      return [
        agent.id,
        {
          name,
          icon: getAgentResolvedIcon(
            agent as Parameters<typeof getAgentResolvedIcon>[0],
          ),
        },
      ];
    }),
  );
}

async function buildBucketLookup(bucketSlugs: string[]): Promise<BucketLookup> {
  if (bucketSlugs.length === 0) {
    return {
      bucketDisplayNameBySlug: {},
      bucketIconBySlug: {},
    };
  }

  const coworkers = await coworkerService.listCoworkers().catch(() => []);
  const coworkerBySlug = new Map<
    string,
    { name: string; imageUrl: string | null }
  >();

  for (const coworker of coworkers) {
    const preview = {
      name: coworker.name,
      imageUrl: getCoworkerImage(coworker),
    };
    coworkerBySlug.set(slugify(coworker.slug), preview);
    coworkerBySlug.set(slugify(coworker.name), preview);
  }

  const modelBySlug = new Map(
    CHAT_MODELS.flatMap((model) => [
      [slugify(model.name), model],
      [slugify(model.id), model],
    ]),
  );

  const bucketDisplayNameBySlug: Record<string, string> = {};
  const bucketIconBySlug: Record<string, HistoryBucketIconPreview> = {};

  for (const bucketSlug of bucketSlugs) {
    const normalizedSlug = slugify(bucketSlug);
    const coworker = coworkerBySlug.get(normalizedSlug);

    if (coworker) {
      bucketDisplayNameBySlug[bucketSlug] = coworker.name;
      bucketIconBySlug[bucketSlug] = {
        kind: "coworker",
        name: coworker.name,
        imageUrl: coworker.imageUrl,
      };
      continue;
    }

    const model = modelBySlug.get(normalizedSlug);
    if (model) {
      bucketDisplayNameBySlug[bucketSlug] = model.name;
      bucketIconBySlug[bucketSlug] = {
        kind: "model",
        modelId: model.id,
        modelName: model.name,
      };
      continue;
    }

    bucketDisplayNameBySlug[bucketSlug] = humanizeSlug(bucketSlug);
  }

  return {
    bucketDisplayNameBySlug,
    bucketIconBySlug,
  };
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
