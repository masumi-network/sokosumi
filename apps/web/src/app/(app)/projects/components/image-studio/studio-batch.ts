import type { StudioProduct, StudioProductPhoto } from "@sokosumi/core-client";

export interface StudioBatchProduct {
  product: StudioProduct;
  photo: StudioProductPhoto | null;
  copies: number;
}
