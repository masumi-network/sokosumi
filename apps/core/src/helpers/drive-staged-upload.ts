import {
  driveHead,
  promoteStagedUpload,
  stagedUploadEtag,
} from "@/lib/drive-blob";
import {
  type DriveResourceKey,
  publishStagedDriveUpload,
} from "@/services/file-catalog.service";

/**
 * Publishes one staged upload attempt onto its Drive pathname: finalize for
 * the attempt's own client, and mint for a pathname an earlier, interrupted
 * publication still claims.
 */
export function publishStagedUpload(key: DriveResourceKey, attemptId: string) {
  return publishStagedDriveUpload({
    key,
    attemptId,
    storage: {
      observe: (staged) => stagedUploadEtag(staged, key.pathname),
      promote: async (staged) => {
        await promoteStagedUpload(staged, key.pathname);
        const stillStaged = Boolean(
          await stagedUploadEtag(staged, key.pathname),
        );
        const stored = await driveHead(key.pathname);
        return {
          stillStaged,
          stored: stored
            ? {
                sizeBytes: stored.size,
                mimeType: stored.contentType ?? "application/octet-stream",
              }
            : null,
        };
      },
    },
  });
}
