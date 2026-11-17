import { createHash, randomUUID } from "node:crypto";

import { privateBlobReadUrl } from "@/lib/blob-read-url";
import { requireStudioBlobToken } from "@/lib/image-studio/blob-store";
import { WORKSPACE_AD_DATA_POLICY_VERSION } from "@/schemas/workspace-ad-data-consent.schema";

import {
  type AdEvalAsset,
  adAssetAspect,
  adAssetsAreComparable,
  adAssetTemplate,
  adFeedbackBelongsToAsset,
  adJudgeScores,
  loadAdEvalAssets,
} from "./ad-evals.service";

export const AD_EVAL_EXPORT_FORMAT_VERSION = "1";
export const AD_EVAL_EXPORT_IMAGE_VALID_MS = 10 * 60 * 1000;

const DIRECTION_IDS = new Set([
  "spotlight",
  "lifestyle",
  "editorial",
  "explainer",
]);
const ASPECTS = new Set(["1:1", "4:5", "9:16", "16:9"]);
const REASON_IDS = new Set([
  "off-brand",
  "bad-text",
  "wrong-product",
  "ugly",
  "great",
  "off_brand",
  "bad_text",
  "wrong_product",
]);
// Font names are editable text: retain recognized families, never arbitrary customer text.
const FONT_FAMILIES = new Set([
  "Arial",
  "Helvetica",
  "Helvetica Neue",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Courier New",
  "Inter",
  "Fraunces",
  "Roboto",
  "Open Sans",
  "Montserrat",
  "Poppins",
  "Lato",
  "Playfair Display",
  "Manrope",
  "DM Sans",
  "Plus Jakarta Sans",
  "Outfit",
  "Nunito",
  "Raleway",
  "Merriweather",
  "Source Sans Pro",
  "Source Sans 3",
  "Source Serif 4",
  "Noto Sans",
  "Noto Serif",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "Space Grotesk",
  "Work Sans",
  "Lora",
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
]);
const IMPLICIT_WEIGHTS: Record<string, number> = {
  viewed_lightbox: 0.1,
  downloaded: 1,
  archived: 1,
  refined: 0.5,
  replaced_in_batch: -0.5,
  copied_to_files: 1,
  attached_to_post: 2,
  scheduled: 2,
  posted: 3,
  hidden: -2,
  deleted: -2,
  regenerated_same_brief: -0.5,
};

export interface AdEvalExportManifest {
  exportId: string;
  formatVersion: string;
  policyVersion: string;
  createdAt: string;
  workspaceHashes: string[];
  rowCount: number;
}

export function adEvalWorkspaceHash(workspaceId: string): string {
  return createHash("sha256")
    .update(`ad-evals-workspace-v1:${workspaceId}`)
    .digest("hex");
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function exportPrompt(asset: AdEvalAsset) {
  const snapshot = asset.job.promptSnapshot;
  const look = snapshot?.brandLook;
  const brand =
    look && typeof look === "object" && !Array.isArray(look) ? look : {};
  const direction = snapshot?.creativeDirection;
  const aspect = adAssetAspect(asset);
  return {
    brief: null,
    final: null,
    text_redacted: true,
    template: adAssetTemplate(asset),
    direction: direction && DIRECTION_IDS.has(direction) ? direction : null,
    aspect: aspect && ASPECTS.has(aspect) ? aspect : null,
    brand: {
      palette: strings(brand.colors)
        .filter((color) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color))
        .slice(0, 8),
      fonts: strings(brand.fonts)
        .filter((font) => FONT_FAMILIES.has(font))
        .slice(0, 4),
    },
  };
}

function exportJudge(asset: AdEvalAsset) {
  const { overall, ...criteria } = adJudgeScores(asset);
  return { ...(overall === undefined ? {} : { overall }), criteria };
}

function exportModel(model: string): string | null {
  return /^[a-z0-9][a-z0-9._/-]{0,179}$/i.test(model) ? model : null;
}

function implicitScore(asset: AdEvalAsset): number {
  return [
    ...new Set(
      asset.adEvents
        .filter((event) => event.workspaceId === asset.workspaceId)
        .map((event) => event.type),
    ),
  ].reduce((score, type) => score + (IMPLICIT_WEIGHTS[type] ?? 0), 0);
}

function thumbLabel(asset: AdEvalAsset): number {
  const total = asset.adFeedback.reduce((sum, feedback) => {
    return feedback.kind === "THUMB" &&
      adFeedbackBelongsToAsset(asset, feedback) &&
      (feedback.thumb === 1 || feedback.thumb === -1)
      ? sum + feedback.thumb
      : sum;
  }, 0);
  return Math.sign(total);
}

interface ExportPair {
  id: string;
  chosen: AdEvalAsset;
  rejected: AdEvalAsset;
  source: "human_pairwise" | "implicit";
  weight: number;
  createdAt: Date;
}

function exportPairs(assets: AdEvalAsset[]): ExportPair[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const pairs: ExportPair[] = [];
  const explicit = new Set<string>();
  for (const asset of assets) {
    for (const feedback of asset.adFeedback) {
      if (
        !adFeedbackBelongsToAsset(asset, feedback) ||
        feedback.kind !== "PAIRWISE"
      )
        continue;
      const other = feedback.otherAssetId
        ? byId.get(feedback.otherAssetId)
        : undefined;
      if (
        !other ||
        !adAssetsAreComparable(asset, other) ||
        (feedback.outcome !== "A" && feedback.outcome !== "B")
      )
        continue;
      const chosen = feedback.outcome === "A" ? asset : other;
      const rejected = feedback.outcome === "A" ? other : asset;
      pairs.push({
        id: feedback.id,
        chosen,
        rejected,
        source: "human_pairwise",
        weight: 1,
        createdAt: feedback.createdAt,
      });
      explicit.add([asset.id, other.id].sort().join(":"));
    }
  }

  const groups = new Map<string, AdEvalAsset[]>();
  for (const asset of assets) {
    if (!asset.job.batchId || !adAssetAspect(asset)) continue;
    const key = JSON.stringify([
      asset.workspaceId,
      asset.projectId,
      asset.job.batchId,
      asset.prompt,
      adAssetAspect(asset),
    ]);
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }
  function addDerived(group: AdEvalAsset[], source: "thumb" | "implicit") {
    const label = source === "thumb" ? thumbLabel : implicitScore;
    const positive = group.filter(
      (asset) => label(asset) >= (source === "thumb" ? 1 : 2),
    );
    const negative = group.filter((asset) => label(asset) < 0);
    // One deterministic match per asset keeps a large batch from creating a quadratic dataset.
    for (
      let index = 0;
      index < Math.min(positive.length, negative.length);
      index++
    ) {
      const chosen = positive[index];
      const rejected = negative[index];
      const key = [chosen.id, rejected.id].sort().join(":");
      if (explicit.has(key)) continue;
      const dates = [chosen, rejected].flatMap((asset) =>
        source === "thumb"
          ? asset.adFeedback
              .filter(
                (feedback) =>
                  adFeedbackBelongsToAsset(asset, feedback) &&
                  feedback.kind === "THUMB" &&
                  (feedback.thumb === 1 || feedback.thumb === -1),
              )
              .map((feedback) => feedback.createdAt)
          : asset.adEvents
              .filter(
                (event) =>
                  event.workspaceId === asset.workspaceId &&
                  IMPLICIT_WEIGHTS[event.type] !== undefined,
              )
              .map((event) => event.createdAt),
      );
      const createdAt = new Date(
        dates.reduce((latest, date) => Math.max(latest, date.getTime()), 0),
      );
      pairs.push({
        id: createHash("sha256").update(`${source}:${key}`).digest("hex"),
        chosen,
        rejected,
        source: source === "thumb" ? "human_pairwise" : "implicit",
        weight: source === "thumb" ? 0.7 : 0.5,
        createdAt,
      });
      explicit.add(key);
    }
  }
  for (const group of groups.values()) {
    addDerived(group, "thumb");
    addDerived(group, "implicit");
  }
  return pairs;
}

/** Brand copy, raw prompts, comments, judge reasons, and user identity never enter the serializer. */
export async function exportAdminAdEvals(): Promise<{
  jsonl: string;
  manifest: AdEvalExportManifest;
}> {
  const exportId = randomUUID();
  const createdAt = new Date().toISOString();
  const assets = await loadAdEvalAssets(true);
  const pairs = exportPairs(assets);
  const imageUrls = new Map<string, string>();
  const rows: string[] = [];
  const workspaceHashes = new Set<string>();
  async function image(asset: AdEvalAsset): Promise<string> {
    const existing = imageUrls.get(asset.id);
    if (existing) return existing;
    const url = await privateBlobReadUrl(
      asset.blobPathname,
      requireStudioBlobToken(),
      AD_EVAL_EXPORT_IMAGE_VALID_MS,
    );
    imageUrls.set(asset.id, url);
    return url;
  }
  async function candidate(asset: AdEvalAsset) {
    return {
      asset_id: asset.id,
      model: exportModel(asset.model),
      image: await image(asset),
      judge: exportJudge(asset),
    };
  }
  for (const pair of pairs) {
    const workspaceHash = adEvalWorkspaceHash(pair.chosen.workspaceId);
    rows.push(
      JSON.stringify({
        export_id: exportId,
        format_version: AD_EVAL_EXPORT_FORMAT_VERSION,
        type: "pair",
        pair_id: pair.id,
        prompt: exportPrompt(pair.chosen),
        chosen: await candidate(pair.chosen),
        rejected: await candidate(pair.rejected),
        source: pair.source,
        weight: pair.weight,
        workspace_hash: workspaceHash,
        created_at: pair.createdAt.toISOString(),
      }),
    );
    workspaceHashes.add(workspaceHash);
  }
  for (const asset of assets) {
    for (const feedback of asset.adFeedback) {
      if (
        !adFeedbackBelongsToAsset(asset, feedback) ||
        feedback.kind !== "THUMB" ||
        (feedback.thumb !== 1 && feedback.thumb !== -1)
      )
        continue;
      const workspaceHash = adEvalWorkspaceHash(asset.workspaceId);
      rows.push(
        JSON.stringify({
          export_id: exportId,
          format_version: AD_EVAL_EXPORT_FORMAT_VERSION,
          type: "rating",
          asset_id: asset.id,
          prompt: exportPrompt(asset),
          model: exportModel(asset.model),
          image: await image(asset),
          label: feedback.thumb,
          reasons: feedback.reasons.filter((reason) => REASON_IDS.has(reason)),
          judge: exportJudge(asset),
          implicit_score: implicitScore(asset),
          workspace_hash: workspaceHash,
          created_at: feedback.createdAt.toISOString(),
        }),
      );
      workspaceHashes.add(workspaceHash);
    }
  }
  return {
    jsonl: rows.length ? `${rows.join("\n")}\n` : "",
    manifest: {
      exportId,
      formatVersion: AD_EVAL_EXPORT_FORMAT_VERSION,
      policyVersion: WORKSPACE_AD_DATA_POLICY_VERSION,
      createdAt,
      workspaceHashes: [...workspaceHashes].sort(),
      rowCount: rows.length,
    },
  };
}
