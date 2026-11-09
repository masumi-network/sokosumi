import type { StudioProduct, StudioProductPhoto } from "@sokosumi/core-client";

// Each job is queued separately against Core's per-project concurrency limit.
export const MAX_BATCH = 12;

export interface StudioBatchProduct {
  product: StudioProduct;
  photo: StudioProductPhoto | null;
  copies: number;
}
