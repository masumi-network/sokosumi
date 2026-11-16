import type { StudioAsset, StudioJob } from "./types";

/**
 * Exact-font overlay is a fallback: for a fresh Ideogram-lettered ad it stays
 * off, and it turns on when the Ideogram step for this backdrop has failed.
 */
export function usesExactFontOverlay(
  asset: Pick<StudioAsset, "id" | "lettering">,
  jobs: readonly Pick<
    StudioJob,
    "parentAssetId" | "lettering" | "status"
  >[] = [],
): boolean {
  if (asset.lettering !== "ideogram") return true;
  return jobs.some(
    (job) =>
      job.parentAssetId === asset.id &&
      job.lettering === "ideogram" &&
      job.status === "FAILED",
  );
}
