import type { AdPairOutcome, Prisma } from "@sokosumi/database";
import { MAX_STUDIO_BATCH_IMAGES, studioAdBrief } from "@sokosumi/utils";

import { payloadTooLarge, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { findImageModelForEndpoint } from "@/lib/image-studio/catalog";
import { imageStudioSettingsSchema } from "@/schemas/project-image-studio.schema";
import {
  type AssetView,
  listStudioBatchAssets,
  type StudioBatchAssetView,
} from "@/services/image-studio-assets.service";

interface ProjectScope {
  projectId: string;
  workspaceId: string;
  userId: string;
}

interface BatchScope extends ProjectScope {
  batchId: string;
}

export interface StudioComparePair {
  a: AssetView;
  b: AssetView;
}

function comparable(a: StudioBatchAssetView, b: StudioBatchAssetView): boolean {
  const aSettings = imageStudioSettingsSchema.safeParse(a.settings);
  const bSettings = imageStudioSettingsSchema.safeParse(b.settings);
  return (
    a.id !== b.id &&
    aSettings.success &&
    bSettings.success &&
    aSettings.data.aspectRatio === bSettings.data.aspectRatio &&
    studioAdBrief(a.batchBrief) === studioAdBrief(b.batchBrief) &&
    studioAdBrief(a.prompt) === studioAdBrief(b.prompt)
  );
}

async function batchAssets(scope: BatchScope): Promise<StudioBatchAssetView[]> {
  const assets = await listStudioBatchAssets(scope);
  if (assets.length > MAX_STUDIO_BATCH_IMAGES) {
    throw payloadTooLarge("Batch exceeds the image limit");
  }
  return assets.sort((a, b) => a.id.localeCompare(b.id));
}

function pairKey(assetId: string, otherAssetId: string): string {
  return [assetId, otherAssetId].sort().join(":");
}

function modelId(endpoint: string): string {
  return findImageModelForEndpoint(endpoint)?.id ?? endpoint;
}

export async function getStudioComparePair(
  scope: BatchScope,
): Promise<StudioComparePair | null> {
  const assets = await batchAssets(scope);
  const picks = await prisma.adFeedback.findMany({
    where: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      batchId: scope.batchId,
      userId: scope.userId,
      kind: "PAIRWISE",
    },
    select: { assetId: true, otherAssetId: true },
  });
  const compared = new Set(
    picks.flatMap((pick) =>
      pick.otherAssetId ? [pairKey(pick.assetId, pick.otherAssetId)] : [],
    ),
  );
  let sameModelPair: StudioComparePair | null = null;
  for (let index = 0; index < assets.length; index++) {
    const a = assets[index];
    if (!a) continue;
    for (const b of assets.slice(index + 1)) {
      if (!comparable(a, b) || compared.has(pairKey(a.id, b.id))) continue;
      if (modelId(a.model) !== modelId(b.model)) return { a, b };
      sameModelPair ??= { a, b };
    }
  }
  return sameModelPair;
}

export async function saveStudioPairwisePick(
  options: BatchScope & {
    assetId: string;
    otherAssetId: string;
    outcome: AdPairOutcome;
  },
) {
  const assets = await batchAssets(options);
  const a = assets.find((asset) => asset.id === options.assetId.toLowerCase());
  const b = assets.find(
    (asset) => asset.id === options.otherAssetId.toLowerCase(),
  );
  if (!a || !b || !comparable(a, b)) {
    throw unprocessableEntity(
      "Choose two ads from this batch with the same brief and placement",
    );
  }

  const reversed = a.id > b.id;
  const assetId = reversed ? b.id : a.id;
  const otherAssetId = reversed ? a.id : b.id;
  const outcome =
    reversed && (options.outcome === "A" || options.outcome === "B")
      ? options.outcome === "A"
        ? "B"
        : "A"
      : options.outcome;
  return prisma.adFeedback.upsert({
    where: {
      userId_assetId_kind_otherAssetId: {
        userId: options.userId,
        assetId,
        kind: "PAIRWISE",
        otherAssetId,
      },
    },
    create: {
      userId: options.userId,
      workspaceId: options.workspaceId,
      projectId: options.projectId,
      batchId: options.batchId,
      assetId,
      otherAssetId,
      kind: "PAIRWISE",
      outcome,
    },
    update: { outcome },
    select: { id: true, assetId: true, otherAssetId: true, outcome: true },
  });
}

const MINIMUM_COMPARISONS = 10;
const INITIAL_ELO = 1000;
const ELO_K = 32;

const scoreboardPickSelect = {
  outcome: true,
  asset: { select: { model: true } },
  otherAsset: { select: { model: true } },
} satisfies Prisma.AdFeedbackSelect;

export function studioModelScoreboard(
  picks: Prisma.AdFeedbackGetPayload<{
    select: typeof scoreboardPickSelect;
  }>[],
) {
  const models = new Map<
    string,
    { model: string; comparisons: number; wins: number; elo: number }
  >();
  function modelScore(model: string) {
    let score = models.get(model);
    if (!score) {
      score = { model, comparisons: 0, wins: 0, elo: INITIAL_ELO };
      models.set(model, score);
    }
    return score;
  }
  for (const pick of picks) {
    if (!pick.outcome || !pick.otherAsset) {
      continue;
    }
    const aModel = modelId(pick.asset.model);
    const bModel = modelId(pick.otherAsset.model);
    if (aModel === bModel) continue;
    const a = modelScore(aModel);
    const b = modelScore(bModel);
    a.comparisons++;
    b.comparisons++;
    // Both bad is a rejection of both ads, with no relative Elo evidence.
    if (pick.outcome === "BOTH_BAD") continue;
    const aWin = pick.outcome === "TIE" ? 0.5 : pick.outcome === "A" ? 1 : 0;
    a.wins += aWin;
    b.wins += 1 - aWin;
    const expectedA = 1 / (1 + 10 ** ((b.elo - a.elo) / 400));
    const change = ELO_K * (aWin - expectedA);
    a.elo += change;
    b.elo -= change;
  }
  return {
    models: [...models.values()]
      .map(({ wins, ...model }) => ({
        ...model,
        winRate: wins / model.comparisons,
        elo: Math.round(model.elo),
        provisional: model.comparisons < MINIMUM_COMPARISONS,
      }))
      .sort(
        (a, b) =>
          b.elo - a.elo ||
          b.winRate - a.winRate ||
          a.model.localeCompare(b.model),
      ),
    minimumComparisons: MINIMUM_COMPARISONS,
  };
}

export async function getStudioModelScoreboard(scope: ProjectScope) {
  await requireProjectAccess(scope);
  const picks = await prisma.adFeedback.findMany({
    where: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      kind: "PAIRWISE",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: scoreboardPickSelect,
  });
  return studioModelScoreboard(picks);
}
