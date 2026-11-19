import type { BlobAccessType } from "@vercel/blob";
import pLimit from "p-limit";

import { driveDelIfMatch } from "@/lib/drive-blob";
import {
  settleDriveUploadDeletes,
  tombstoneDriveUploadResources,
} from "@/services/file-catalog.service";

export interface ObservedDriveObject {
  pathname: string;
  access: BlobAccessType;
  etag: string;
}

/**
 * Deletes the Drive objects a request observed. Each document is tombstoned
 * first (it stops matching at once) but keeps owning its bytes; each object
 * is deleted only while it is still the one observed; then the hold is
 * released. A storage failure leaves the hold, so nothing adopts the bytes
 * as a new document (no new identity, no paid labelling) and the next delete
 * of the pathname finishes the job. A newer object at a pathname stays.
 */
export async function deleteObservedDriveFiles(input: {
  workspaceId: string;
  scope: "user" | "organization";
  objects: readonly ObservedDriveObject[];
}): Promise<void> {
  const { workspaceId, scope, objects } = input;
  if (objects.length === 0) return;
  await tombstoneDriveUploadResources({
    workspaceId,
    scope,
    pathnames: objects.map((object) => object.pathname),
    deleting: true,
  });
  const limit = pLimit(10);
  const outcomes = await Promise.allSettled(
    objects.map((object) =>
      limit(() => driveDelIfMatch(object.pathname, object)),
    ),
  );
  await settleDriveUploadDeletes({
    workspaceId,
    scope,
    pathnames: objects
      .filter((_, index) => outcomes[index].status === "fulfilled")
      .map((object) => object.pathname),
  });
  const failed = outcomes.find((outcome) => outcome.status === "rejected");
  if (failed) throw failed.reason;
}
