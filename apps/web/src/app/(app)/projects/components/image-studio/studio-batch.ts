import type { StudioProduct, StudioProductPhoto } from "@sokosumi/core-client";
import { studioAdBrief } from "@sokosumi/utils";

import { isVideoAsset, type StudioAsset } from "./types";

export interface StudioBatchProduct {
  product: StudioProduct;
  photo: StudioProductPhoto | null;
  copies: number;
}

export interface StudioBatchDownloadReview {
  assets: StudioAsset[];
  onChanged: () => void;
}

export function canCompareStudioAsset(
  asset: StudioAsset,
  assets: StudioAsset[],
): boolean {
  if (!asset.batchId || isVideoAsset(asset) || !asset.settings?.aspectRatio)
    return false;
  return assets.some(
    (other) =>
      other.id !== asset.id &&
      other.projectId === asset.projectId &&
      other.batchId === asset.batchId &&
      !isVideoAsset(other) &&
      other.settings?.aspectRatio === asset.settings?.aspectRatio &&
      studioAdBrief(other.prompt) === studioAdBrief(asset.prompt),
  );
}
