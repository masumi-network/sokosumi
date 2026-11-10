import type { StudioProduct, StudioProductPhoto } from "@sokosumi/core-client";

import type { StudioAsset } from "./types";

export interface StudioBatchProduct {
  product: StudioProduct;
  photo: StudioProductPhoto | null;
  copies: number;
}

export interface StudioBatchDownloadReview {
  assets: StudioAsset[];
  onChanged: () => void;
}
