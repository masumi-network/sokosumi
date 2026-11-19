import { driveHead } from "@/lib/drive-blob";
import {
  publishDriveCopyResource,
  releaseDriveCopyResource,
  staleDriveCopyClaims,
} from "@/services/file-catalog.service";

/**
 * Well past the longest a copy request can run (300 s), so no request can
 * still be publishing a claim this old and any write it started has settled.
 */
const STALE_AFTER_MS = 15 * 60_000;

/**
 * Settle the copies a request left unpublished: it failed, timed out, or
 * lost the answer to a write or a commit. Storage is read outside any
 * transaction, then one fenced catalog step:
 *
 * - No bytes at the claim's pathname: nothing was exposed, so the claim is
 *   given back and the name is free again.
 * - Bytes there: published as the copy, live and pinned free, with their
 *   own size and type. The claim fences every catalog writer off this name,
 *   so only a storage-first rename could have put other bytes there, and
 *   its own catalog step then failed on this claim. Either way the bytes
 *   are kept and reachable, and no paid model labels them.
 */
export async function reconcileStaleDriveCopies(take = 50) {
  const claims = await staleDriveCopyClaims(
    new Date(Date.now() - STALE_AFTER_MS),
    take,
  );
  let published = 0;
  let released = 0;
  for (const claim of claims) {
    const there = await driveHead(claim.sourceId);
    if (!there) {
      await releaseDriveCopyResource({
        resourceId: claim.id,
        pathname: claim.sourceId,
      });
      released += 1;
    } else if (
      await publishDriveCopyResource({
        resourceId: claim.id,
        pathname: claim.sourceId,
        sizeBytes: there.size,
        mimeType: there.contentType,
      })
    ) {
      published += 1;
    }
  }
  return { published, released };
}
