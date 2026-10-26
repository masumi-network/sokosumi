import type { CatalogExclusion } from "./fal-catalog-fetch";
import snapshot from "./fal-video-catalog-snapshot.json";
import {
  DEFAULT_ANIMATE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  HIGH_QUALITY_ANIMATE_MODEL_ID,
  HIGH_QUALITY_VIDEO_MODEL_ID,
  isUnchargeableVideoModel,
  type VideoModel,
} from "./video-model";

/**
 * Which video models the studio has. The video counterpart of {@link ./catalog},
 * with the same three layers: hand-verified overrides, fal's own API (refreshed
 * by {@link ./fal-catalog-refresh}), and a committed snapshot for a cold start.
 *
 * One difference, and it is about money: a video model is offered only once a
 * person has verified its per-second price at every resolution the studio sends.
 * fal's pricing API reports the cheapest tier, and the studio does not bill a
 * number it cannot stand behind.
 */

interface VideoCatalogSnapshotFile {
  generatedAt: string;
  models: unknown[];
}

export interface VideoCatalog {
  defaultModelId: string;
  defaultAnimateModelId: string;
  /** Curated shortlist first, in rank order, then everything else by label. */
  models: VideoModel[];
  snapshotDate: string;
}

interface VideoModelOverride
  extends Partial<Omit<VideoModel, "endpoint" | "price">> {
  endpoint: string;
  price?: Partial<VideoModel["price"]>;
}

/** Read off each model page on 2026-10-25. */
const PRICES_VERIFIED_AT = "2026-10-25";

/**
 * The hand-verified layer: ids, ranks, resolutions and the per-second prices.
 *
 * MiniMax H3 prices are fal's list prices after the launch discount that ends on
 * 2026-10-31. Charging the discounted figure would undercharge from November;
 * charging list overcharges by a few credits for a week, which is the safer side.
 */
function videoModelOverrides(): VideoModelOverride[] {
  const h3Turbo = {
    resolutions: ["768P", "480P"],
    price: {
      perSecondUsd: { "480P": 0.025, "768P": 0.04 },
      basis:
        "$0.04 per second at 768P and $0.025 at 480P, fal's list price for H3 Max Turbo (launch discount ignored).",
      verifiedAt: PRICES_VERIFIED_AT,
    },
  };
  const h3Max = {
    resolutions: ["768P", "480P"],
    price: {
      perSecondUsd: { "480P": 0.05, "768P": 0.08 },
      basis:
        "$0.08 per second at 768P and $0.05 at 480P, fal's list price for H3 Max (launch discount ignored).",
      verifiedAt: PRICES_VERIFIED_AT,
    },
  };
  const kling = {
    resolutions: ["720p"],
    price: {
      perSecondUsd: { "720p": 0.157 },
      basis:
        "$0.157 per second at 720p, as fal lists it. The studio never asks for 1080p, which costs $0.235.",
      verifiedAt: PRICES_VERIFIED_AT,
    },
  };
  return [
    {
      endpoint: "minimax/h3-max-turbo/text-to-video",
      id: DEFAULT_VIDEO_MODEL_ID,
      label: "MiniMax H3 Max Turbo",
      description: "Fast, low-cost video from a prompt, up to 15 seconds.",
      curatedRank: 1,
      ...h3Turbo,
    },
    {
      endpoint: "minimax/h3-max/text-to-video",
      id: HIGH_QUALITY_VIDEO_MODEL_ID,
      label: "MiniMax H3 Max",
      description: "Higher-quality video from a prompt, up to 15 seconds.",
      curatedRank: 2,
      ...h3Max,
    },
    {
      endpoint: "kling/v4/text-to-video",
      id: "kling-v4",
      label: "Kling 4.0",
      description: "Premium cinematic video from a prompt.",
      curatedRank: 3,
      ...kling,
    },
    {
      endpoint: "minimax/h3-max-turbo/image-to-video",
      id: DEFAULT_ANIMATE_MODEL_ID,
      label: "MiniMax H3 Max Turbo (animate)",
      description: "Brings a still image to life, fast and low-cost.",
      curatedRank: 4,
      ...h3Turbo,
    },
    {
      endpoint: "minimax/h3-max/image-to-video",
      id: HIGH_QUALITY_ANIMATE_MODEL_ID,
      label: "MiniMax H3 Max (animate)",
      description: "Brings a still image to life at higher quality.",
      curatedRank: 5,
      ...h3Max,
    },
    {
      endpoint: "kling/v4/image-to-video",
      id: "kling-v4-animate",
      label: "Kling 4.0 (animate)",
      description: "Premium cinematic motion from a still image.",
      curatedRank: 6,
      ...kling,
    },
  ];
}

/** The endpoints a person has verified, and so the only ones worth crawling. */
export function verifiedVideoEndpoints(): ReadonlySet<string> {
  return new Set(videoModelOverrides().map((override) => override.endpoint));
}

/** Merge the hand-verified layer onto the fetched rows, matching on endpoint. */
export function applyVideoCatalogOverrides(
  fetched: VideoModel[],
): VideoModel[] {
  const byEndpoint = new Map(fetched.map((model) => [model.endpoint, model]));
  for (const { endpoint, price, ...rest } of videoModelOverrides()) {
    const base = byEndpoint.get(endpoint);
    // A model fal no longer describes cannot be rebuilt from an override alone:
    // its durations and input fields come from fal's schema.
    if (!base) continue;
    byEndpoint.set(endpoint, {
      ...base,
      ...rest,
      // The provider's own values only: an override cannot add a resolution the
      // endpoint does not accept.
      resolutions: (rest.resolutions ?? base.resolutions).filter(
        (value) =>
          base.resolutions.length === 0 || base.resolutions.includes(value),
      ),
      price: { ...base.price, ...price },
    });
  }
  return [...byEndpoint.values()];
}

/** Drop rows no verified price covers. Run after overrides, like the image filter. */
export function excludeUnpriceableVideoModels(models: VideoModel[]): {
  models: VideoModel[];
  exclusions: CatalogExclusion[];
} {
  const kept: VideoModel[] = [];
  const exclusions: CatalogExclusion[] = [];
  for (const model of models) {
    if (!isUnchargeableVideoModel(model)) {
      kept.push(model);
      continue;
    }
    exclusions.push({
      endpointId: model.endpoint,
      reason:
        "No hand-verified per-second price at every resolution the studio would send.",
    });
  }
  return { models: kept, exclusions };
}

function sortModels(models: VideoModel[]): VideoModel[] {
  return [...models].sort((left, right) => {
    const leftRank = left.curatedRank ?? Number.POSITIVE_INFINITY;
    const rightRank = right.curatedRank ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.label.localeCompare(right.label);
  });
}

function resolveVideoCatalogModels(fetched: VideoModel[]): VideoModel[] {
  return sortModels(
    excludeUnpriceableVideoModels(applyVideoCatalogOverrides(fetched)).models,
  );
}

const SNAPSHOT = snapshot as VideoCatalogSnapshotFile;

let resolvedModels: VideoModel[] = resolveVideoCatalogModels(
  SNAPSHOT.models as VideoModel[],
);

/** Replace the resolved catalog. Only {@link ./fal-catalog-refresh} calls this. */
export function setResolvedVideoCatalog(fetched: VideoModel[]): boolean {
  const models = resolveVideoCatalogModels(fetched);
  if (models.length === 0) return false;
  resolvedModels = models;
  return true;
}

function preferredId(wanted: string, input: VideoModel["input"]): string {
  if (resolvedModels.some((model) => model.id === wanted)) return wanted;
  return resolvedModels.find((model) => model.input === input)?.id ?? wanted;
}

export function getVideoCatalog(): VideoCatalog {
  return {
    defaultModelId: preferredId(DEFAULT_VIDEO_MODEL_ID, "text"),
    defaultAnimateModelId: preferredId(DEFAULT_ANIMATE_MODEL_ID, "image"),
    models: resolvedModels,
    snapshotDate: SNAPSHOT.generatedAt,
  };
}

/** The model for an id, or the default for this input when no id is given. */
export function videoModel(
  id: string | undefined,
  input: VideoModel["input"] = "text",
): VideoModel {
  const wanted =
    id ??
    preferredId(
      input === "image" ? DEFAULT_ANIMATE_MODEL_ID : DEFAULT_VIDEO_MODEL_ID,
      input,
    );
  const model = resolvedModels.find((candidate) => candidate.id === wanted);
  if (!model)
    throw new Error(
      "Unsupported video model. Choose a model from the studio catalog.",
    );
  return model;
}

/** The model behind a stored job's endpoint, or null once it is withdrawn. */
export function findVideoModelForEndpoint(endpoint: string): VideoModel | null {
  return resolvedModels.find((model) => model.endpoint === endpoint) ?? null;
}
