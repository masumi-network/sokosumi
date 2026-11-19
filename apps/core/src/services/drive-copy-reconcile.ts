import { driveHead } from "@/lib/drive-blob";
import { recordCoreWarning } from "@/lib/evlog";
import {
  publishDriveCopyResource,
  recordedDriveCopyClaims,
  releaseDriveCopyResource,
} from "@/services/file-catalog.service";

/** Only schedules: a request still running gets this long to publish. */
const STALE_AFTER_MS = 15 * 60_000;

/**
 * Finish copies whose write is proven and recorded but whose request did not
 * publish them (it failed or lost the answer after recording). Nothing else:
 * a claim with no recorded write is never published or released here.
 *
 * - Bytes at the pathname carry the recorded ETag: publish them.
 * - No bytes: the recorded write is gone and cannot land again, so the claim
 *   is given back.
 * - Other bytes: left alone.
 *
 * Each claim is settled on its own, and the sweep stops when the tick is out
 * of time, so a broken claim never holds up the next one or the indexing.
 */
export async function reconcileStaleDriveCopies(
  options: { shouldContinue?: () => boolean; take?: number } = {},
) {
  const claims = await recordedDriveCopyClaims(
    new Date(Date.now() - STALE_AFTER_MS),
    options.take ?? 50,
  );
  const result = { published: 0, released: 0, kept: 0, failed: 0 };
  for (const claim of claims) {
    if (options.shouldContinue && !options.shouldContinue()) break;
    try {
      const there = await driveHead(claim.pathname);
      if (!there) {
        await releaseDriveCopyResource({
          resourceId: claim.resourceId,
          pathname: claim.pathname,
        });
        result.released += 1;
      } else if (
        there.etag === claim.etag &&
        (await publishDriveCopyResource({
          ...claim,
          sizeBytes: there.size,
          mimeType: there.contentType,
        }))
      ) {
        result.published += 1;
      } else {
        result.kept += 1;
      }
    } catch (error) {
      result.failed += 1;
      recordCoreWarning(
        { job: "drive-copy-reconcile" },
        {
          message: "Could not settle a Drive copy",
          why: "Its next sweep tries again.",
          cause: error,
        },
        { resourceId: claim.resourceId },
      );
    }
  }
  return result;
}
