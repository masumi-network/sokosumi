import pLimit from "p-limit";

import { conflict } from "@/helpers/error";
import { driveDelIfMatch, driveHead } from "@/lib/drive-blob";
import {
  type DriveResourceKey,
  driveDocumentAt,
  holdDriveUploadForDelete,
  releaseDriveUploadDeleteHold,
  releaseDriveUploadDeleteHolds,
} from "@/services/file-catalog.service";

/**
 * Deletes Drive files, each bound to what this request observed: the
 * document (id and revision) and the object (ETag) at the pathname, read so
 * that a change between the two reads is caught (409, nothing touched).
 *
 * The observed document is tombstoned first (it stops matching at once) but
 * keeps owning its bytes; the observed object is deleted only while it is
 * still that object; then the hold is released. A storage failure leaves the
 * hold, so nothing adopts the bytes as a new document (no new identity, no
 * paid labelling) and the next delete finishes the job. A document or object
 * that replaced the observed one is never touched.
 *
 * Returns the pathnames whose observed object is gone.
 */
export async function deleteDriveFiles(input: {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
  pathnames: readonly string[];
}): Promise<string[]> {
  const limit = pLimit(10);
  const outcomes = await Promise.allSettled(
    input.pathnames.map((pathname) =>
      limit(() => deleteObserved({ ...input, pathname })),
    ),
  );
  const failed = outcomes.find((outcome) => outcome.status === "rejected");
  if (failed) throw failed.reason;
  return input.pathnames.filter(
    (_, index) =>
      outcomes[index].status === "fulfilled" &&
      (outcomes[index] as PromiseFulfilledResult<boolean>).value,
  );
}

async function deleteObserved(key: DriveResourceKey): Promise<boolean> {
  const before = await driveDocumentAt(key);
  const object = await driveHead(key.pathname);
  const document = await driveDocumentAt(key);
  if (
    before?.resourceId !== document?.resourceId ||
    before?.revision !== document?.revision
  ) {
    throw conflict("The file changed while it was being deleted");
  }
  if (document && !(await holdDriveUploadForDelete({ key, ...document }))) {
    throw conflict("The file changed while it was being deleted");
  }
  const gone = object ? await driveDelIfMatch(key.pathname, object) : true;
  // Gone, or replaced by a newer object: either way the observed bytes no
  // longer exist, so the deleted document stops owning the pathname.
  if (document) {
    await releaseDriveUploadDeleteHold({
      key,
      resourceId: document.resourceId,
    });
  } else {
    // No live document: these bytes were an earlier delete's, held when its
    // storage call failed. They are gone now, so that hold ends too.
    await releaseDriveUploadDeleteHolds(key);
  }
  return gone;
}
