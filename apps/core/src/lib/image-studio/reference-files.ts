import { FileSourceKind, type Prisma } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { loadLiveResources } from "@/services/file-search.service";

export async function requireStudioReferenceFiles(
  input: { workspaceId: string; actor: FileActor; resourceIds: string[] },
  tx: Prisma.TransactionClient = prisma,
) {
  if (!input.resourceIds.length) return [];
  const files = await loadLiveResources(input, tx);
  return input.resourceIds.map((id) => {
    const file = files.find((candidate) => candidate.id === id);
    if (
      file?.sourceKind !== FileSourceKind.DRIVE_UPLOAD ||
      !file.mimeType?.startsWith("image/")
    ) {
      throw notFound("A reference image was not found in your Files.");
    }
    if ((file.sizeBytes ?? 0) > LIMITS.IMAGE_STUDIO_MAX_REFERENCE_BYTES) {
      throw unprocessableEntity("A reference image is too large to send.");
    }
    return file.sourceId;
  });
}
