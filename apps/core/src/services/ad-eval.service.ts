import { waitUntil } from "@vercel/functions";
import sharp from "sharp";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import {
  finalizeAdEval,
  reserveAdEval,
} from "@/lib/image-studio/ad-eval-budget";
import {
  evaluateAdHardChecks,
  extractDominantColors,
} from "@/lib/image-studio/ad-eval-checks";
import {
  AD_EVAL_RUBRIC_VERSION,
  judgeAdImage,
} from "@/lib/image-studio/ad-eval-judge";
import { findImageModelForEndpoint } from "@/lib/image-studio/catalog";
import { CURATED_MODEL_IDS } from "@/lib/image-studio/catalog-overrides";
import { studioBrandLookSchema } from "@/schemas/studio-brand-kit.schema";
import { readAssetBytes } from "@/services/image-studio-assets.service";

function adEvalsEnabled(): boolean {
  const env = getEnv();
  return env.AD_EVALS_ENABLED && !env.AD_EVALS_PAUSED;
}

/** Register after the asset commits; evaluation must never interrupt delivery. */
export function enqueueAdEval(jobId: string): void {
  try {
    if (!adEvalsEnabled()) return;
    waitUntil(
      evaluateSettledAd(jobId).catch(() => {
        console.warn("[ad-evals] background evaluation failed", { jobId });
      }),
    );
  } catch {
    console.warn("[ad-evals] could not register background evaluation", {
      jobId,
    });
  }
}

async function judgeImageBytes(
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const resized = await sharp(bytes, { limitInputPixels: 70_000_000 })
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(resized);
}

async function evaluateSettledAd(jobId: string): Promise<void> {
  if (!adEvalsEnabled()) return;
  const asset = await prisma.projectImageAsset.findUnique({
    where: { jobId },
    include: {
      job: { include: { promptSnapshot: true } },
      workspace: { select: { organizationId: true } },
    },
  });
  if (
    !asset ||
    asset.mediaType !== "IMAGE" ||
    !CURATED_MODEL_IDS.some(
      (model) => model === findImageModelForEndpoint(asset.model)?.id,
    ) ||
    !asset.job.promptSnapshot
  )
    return;

  const snapshot = asset.job.promptSnapshot;
  const env = getEnv();
  if (!adEvalsEnabled() || !env.AI_GATEWAY_API_KEY) return;
  const evalId = await reserveAdEval({
    assetId: asset.id,
    workspaceId: asset.workspaceId,
    rubricVersion: AD_EVAL_RUBRIC_VERSION,
    workspaceDailyLimit: env.AD_EVALS_WORKSPACE_DAILY_LIMIT,
    globalDailyUsd: env.AD_EVALS_GLOBAL_DAILY_USD,
  });
  if (!evalId) return;

  const bytes = await readAssetBytes(asset.blobPathname);
  const decoded = sharp(bytes, { limitInputPixels: 70_000_000 });
  const metadata = await decoded.metadata();
  const raw = await decoded
    .clone()
    .resize(128, 128, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer();

  let referenceImage: Uint8Array<ArrayBuffer> | undefined;
  const photoId = asset.job.referenceFileIds.at(-1);
  if (photoId) {
    const { downloadStudioFileReference } = await import(
      "@/services/image-studio-jobs.service"
    );
    const { bytes: reference } = await downloadStudioFileReference(
      asset.workspaceId,
      photoId,
      {
        userId: asset.job.requestedByUserId,
        organizationId: asset.workspace.organizationId,
        kind:
          asset.job.idempotencyKey.startsWith("soko-bot:") ||
          asset.job.idempotencyKey.startsWith("cmo-media:")
            ? "soko_bot"
            : "interactive",
      },
    );
    referenceImage = await judgeImageBytes(reference);
  }

  const approvedLines =
    snapshot.finalPrompt
      .split("Approved ad copy (use where relevant):\n")[1]
      ?.split("\n\n")[0]
      ?.split("\n")
      .filter(Boolean) ?? [];
  const look = studioBrandLookSchema.safeParse(snapshot.brandLook);
  const image = await judgeImageBytes(bytes);
  const logoRequested =
    !asset.job.useProductCutout &&
    /\b(?:include|render|add|show|display|place|draw|use|with)\b[^.\n]{0,40}\blogo\b/i.test(
      asset.prompt,
    ) &&
    !/\b(?:no|without|exclude)\s+(?:\w+\s+)?logos?\b/i.test(asset.prompt);
  if (!adEvalsEnabled()) return;
  const result = await judgeAdImage({
    image,
    referenceImage,
    finalPrompt: snapshot.finalPrompt,
    brandLook: snapshot.brandLook,
    headline: asset.job.exportHeadline,
    approvedLines,
    useProductCutout: asset.job.useProductCutout,
    logoRequested,
  });

  const settings = asset.settings;
  const aspectRatio =
    settings &&
    typeof settings === "object" &&
    !Array.isArray(settings) &&
    typeof settings.aspectRatio === "string"
      ? settings.aspectRatio
      : "";
  const checks = evaluateAdHardChecks({
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    aspectRatio,
    dominantColors: extractDominantColors(raw),
    brandColors: look.success ? look.data.colors : [],
    expectedText: asset.job.exportHeadline
      ? [asset.job.exportHeadline]
      : approvedLines,
    prompt: snapshot.finalPrompt,
    useProductCutout: asset.job.useProductCutout,
    logoRequested,
    observations: result.judge.observations,
  });
  await finalizeAdEval({
    id: evalId,
    checks,
    judge: result.rawJson,
    judgeModel: result.judgeModel,
    overall: result.judge.overall,
    latencyMs: result.latencyMs,
    costUsdMicros: result.costUsdMicros,
  });
}
