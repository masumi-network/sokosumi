import type { Prisma } from "@sokosumi/database";
import type { z } from "zod";

import {
  meanConfidenceInterval,
  rateConfidenceInterval,
  spearmanCorrelation,
} from "@/helpers/ad-evals-statistics";
import prisma from "@/lib/db/prisma";
import type { adminAdEvalsDashboardSchema } from "@/schemas/ad-evals.schema";

export const AD_EVALS_MINIMUM_WORKSPACES = 5;
const TEMPLATE_IDS = new Set([
  "story-ad",
  "social-post",
  "product-announcement",
  "ad",
  "banner",
]);
export const AD_EVAL_CRITERIA = [
  "brief_adherence",
  "brand_fit",
  "composition",
  "text_quality",
  "product_fidelity",
  "ad_effectiveness",
  "overall",
] as const;

const adEvalAssetSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  model: true,
  prompt: true,
  settings: true,
  blobPathname: true,
  job: {
    select: {
      batchId: true,
      promptSnapshot: {
        select: {
          templateId: true,
          creativeDirection: true,
          brandLook: true,
        },
      },
    },
  },
  adEvals: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { workspaceId: true, judge: true, overall: true },
  },
  adFeedback: {
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      kind: true,
      otherAssetId: true,
      thumb: true,
      outcome: true,
      reasons: true,
      createdAt: true,
    },
  },
  adEvents: { select: { workspaceId: true, type: true, createdAt: true } },
} satisfies Prisma.ProjectImageAssetSelect;

export type AdEvalAsset = Prisma.ProjectImageAssetGetPayload<{
  select: typeof adEvalAssetSelect;
}>;

/** Consent is applied to the owning workspace in the database, before any rows leave Core. */
export async function loadAdEvalAssets(
  training: boolean,
): Promise<AdEvalAsset[]> {
  return prisma.projectImageAsset.findMany({
    where: {
      mediaType: "IMAGE",
      workspace: {
        adDataConsent: {
          is: {
            shareForImprovement: true,
            ...(training ? { allowTraining: true } : {}),
          },
        },
      },
      OR: [
        { adEvals: { some: {} } },
        { adFeedback: { some: {} } },
        { adOtherFeedback: { some: {} } },
        { adEvents: { some: {} } },
      ],
    },
    select: adEvalAssetSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

export function adAssetAspect(asset: AdEvalAsset): string | null {
  const aspect = record(asset.settings).aspectRatio;
  return typeof aspect === "string" && /^\d{1,2}:\d{1,2}$/.test(aspect)
    ? aspect
    : null;
}

export function adAssetTemplate(asset: AdEvalAsset): string | null {
  const template = asset.job.promptSnapshot?.templateId;
  return template && TEMPLATE_IDS.has(template) ? template : null;
}

/** Only numeric rubric scores are returned; judge reasons can quote private brand text. */
export function adJudgeScores(asset: AdEvalAsset): Record<string, number> {
  const evaluation = asset.adEvals[0];
  if (!evaluation || evaluation.workspaceId !== asset.workspaceId) return {};
  const judge = record(evaluation?.judge);
  const criteria = record(judge.criteria);
  const scores: Record<string, number> = {};
  for (const id of AD_EVAL_CRITERIA) {
    const criterion = criteria[id];
    const value =
      id === "overall"
        ? (evaluation?.overall ?? judge.overall)
        : typeof criterion === "number"
          ? criterion
          : record(criterion).score;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 1 &&
      value <= 5
    ) {
      scores[id] = value;
    }
  }
  return scores;
}

export function adAssetsAreComparable(a: AdEvalAsset, b: AdEvalAsset): boolean {
  const aspect = adAssetAspect(a);
  return (
    a.id !== b.id &&
    a.workspaceId === b.workspaceId &&
    a.projectId === b.projectId &&
    a.job.batchId !== null &&
    a.job.batchId === b.job.batchId &&
    aspect !== null &&
    aspect === adAssetAspect(b)
  );
}

export function adFeedbackBelongsToAsset(
  asset: AdEvalAsset,
  feedback: AdEvalAsset["adFeedback"][number],
): boolean {
  return (
    feedback.workspaceId === asset.workspaceId &&
    feedback.projectId === asset.projectId
  );
}

interface LeaderboardCell {
  model: string;
  template: string | null;
  aspect: string | null;
  workspaces: Set<string>;
  thumbWorkspaces: Set<string>;
  pairwiseWorkspaces: Set<string>;
  judgeWorkspaces: Set<string>;
  n: number;
  thumbs: number[];
  pairwise: number[];
  judge: number[];
}

function average(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

export async function getAdminAdEvalsDashboard(): Promise<
  z.infer<typeof adminAdEvalsDashboardSchema>
> {
  const assets = await loadAdEvalAssets(false);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const compared = new Set<string>();
  for (const asset of assets) {
    for (const feedback of asset.adFeedback) {
      const other = feedback.otherAssetId
        ? byId.get(feedback.otherAssetId)
        : undefined;
      if (
        adFeedbackBelongsToAsset(asset, feedback) &&
        feedback.kind === "PAIRWISE" &&
        feedback.outcome !== null &&
        other &&
        adAssetsAreComparable(asset, other)
      ) {
        compared.add(asset.id);
        compared.add(other.id);
      }
    }
  }
  const cells = new Map<string, LeaderboardCell>();
  const assetCells = new Map<string, LeaderboardCell>();
  const observations = new Map<
    string,
    {
      signal: "thumb" | "pairwise";
      criterion: string;
      pairs: [number, number][];
    }
  >();

  function observe(
    signal: "thumb" | "pairwise",
    criterion: string,
    score: number,
    label: number,
  ) {
    const key = `${signal}:${criterion}`;
    const current = observations.get(key) ?? { signal, criterion, pairs: [] };
    current.pairs.push([score, label]);
    observations.set(key, current);
  }

  for (const asset of assets) {
    const scores = adJudgeScores(asset);
    const thumbs = asset.adFeedback.filter(
      (feedback) =>
        adFeedbackBelongsToAsset(asset, feedback) &&
        feedback.kind === "THUMB" &&
        (feedback.thumb === 1 || feedback.thumb === -1),
    );
    if (
      !Object.keys(scores).length &&
      !thumbs.length &&
      !compared.has(asset.id)
    )
      continue;
    const template = adAssetTemplate(asset);
    const aspect = adAssetAspect(asset);
    const key = JSON.stringify([asset.model, template, aspect]);
    const cell = cells.get(key) ?? {
      model: asset.model,
      template,
      aspect,
      workspaces: new Set<string>(),
      thumbWorkspaces: new Set<string>(),
      pairwiseWorkspaces: new Set<string>(),
      judgeWorkspaces: new Set<string>(),
      n: 0,
      thumbs: [],
      pairwise: [],
      judge: [],
    };
    cell.workspaces.add(asset.workspaceId);
    cell.n++;
    if (scores.overall !== undefined) {
      cell.judge.push(scores.overall);
      cell.judgeWorkspaces.add(asset.workspaceId);
    }
    for (const feedback of thumbs) {
      cell.thumbs.push(feedback.thumb === 1 ? 1 : 0);
      cell.thumbWorkspaces.add(asset.workspaceId);
      for (const [criterion, score] of Object.entries(scores)) {
        observe("thumb", criterion, score, feedback.thumb === 1 ? 1 : -1);
      }
    }
    assetCells.set(asset.id, cell);
    cells.set(key, cell);
  }

  for (const asset of assets) {
    const scores = adJudgeScores(asset);
    for (const feedback of asset.adFeedback) {
      if (!adFeedbackBelongsToAsset(asset, feedback)) continue;
      if (feedback.kind !== "PAIRWISE" || !feedback.otherAssetId) continue;
      const other = byId.get(feedback.otherAssetId);
      if (!other || !adAssetsAreComparable(asset, other)) continue;
      const a = assetCells.get(asset.id);
      const b = assetCells.get(other.id);
      if (!a || !b) continue;
      const outcome = feedback.outcome;
      if (
        outcome !== "A" &&
        outcome !== "B" &&
        outcome !== "TIE" &&
        outcome !== "BOTH_BAD"
      )
        continue;
      a.pairwiseWorkspaces.add(asset.workspaceId);
      b.pairwiseWorkspaces.add(other.workspaceId);
      if (outcome === "BOTH_BAD") {
        a.pairwise.push(0);
        b.pairwise.push(0);
        continue;
      }
      const label = outcome === "A" ? 1 : outcome === "B" ? -1 : 0;
      a.pairwise.push((label + 1) / 2);
      b.pairwise.push((1 - label) / 2);
      const otherScores = adJudgeScores(other);
      for (const [criterion, score] of Object.entries(scores)) {
        if (otherScores[criterion] !== undefined) {
          observe("pairwise", criterion, score - otherScores[criterion], label);
        }
      }
    }
  }

  return {
    minimumWorkspaces: AD_EVALS_MINIMUM_WORKSPACES,
    leaderboard: [...cells.values()].map((cell) => {
      const suppressed = cell.workspaces.size < AD_EVALS_MINIMUM_WORKSPACES;
      const hideThumbs =
        cell.thumbWorkspaces.size < AD_EVALS_MINIMUM_WORKSPACES;
      const hidePairwise =
        cell.pairwiseWorkspaces.size < AD_EVALS_MINIMUM_WORKSPACES;
      const hideJudge = cell.judgeWorkspaces.size < AD_EVALS_MINIMUM_WORKSPACES;
      const thumbTotal = cell.thumbs.reduce((sum, value) => sum + value, 0);
      const pairwiseTotal = cell.pairwise.reduce(
        (sum, value) => sum + value,
        0,
      );
      return {
        model: cell.model,
        template: cell.template,
        aspect: cell.aspect,
        workspaceCount: cell.workspaces.size,
        suppressed,
        n: cell.n,
        thumbN: cell.thumbs.length,
        pairwiseN: cell.pairwise.length,
        judgeN: cell.judge.length,
        thumbRate: hideThumbs ? null : average(cell.thumbs),
        pairwiseWinRate: hidePairwise ? null : average(cell.pairwise),
        judgeMean: hideJudge ? null : average(cell.judge),
        thumbRateCi: hideThumbs
          ? null
          : rateConfidenceInterval(thumbTotal, cell.thumbs.length),
        pairwiseWinRateCi: hidePairwise
          ? null
          : rateConfidenceInterval(pairwiseTotal, cell.pairwise.length),
        judgeMeanCi: hideJudge ? null : meanConfidenceInterval(cell.judge),
      };
    }),
    agreement: [...observations.values()].map(
      ({ criterion, signal, pairs }) => {
        const rho = spearmanCorrelation(pairs);
        return {
          criterion,
          signal,
          rho,
          n: pairs.length,
          lowAgreement: rho !== null && rho < 0.3,
        };
      },
    ),
  };
}
