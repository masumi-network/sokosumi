import type { CmoStrategy } from "@sokosumi/soko-bot";
import { head } from "@vercel/blob";

import type { FileActor } from "@/lib/files/actor";
import { loadLiveResources } from "@/services/file-search.service";

export interface CmoCalendarMedia {
  entryId: string;
  kind: "image" | "video";
  url: string;
}

/**
 * The image or video Cuso attached to each calendar piece, so the owner sees
 * it in CMO rather than only in Sokosumi's Content Studio. The daily run
 * copies studio media into the owner's Files, a store Social posting already
 * reads from; only files the owner may open, and only images and videos.
 */
export async function cmoCalendarMedia(input: {
  strategy: CmoStrategy | null;
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}): Promise<CmoCalendarMedia[]> {
  const attached = (input.strategy?.calendar ?? []).filter(
    (entry): entry is typeof entry & { imageFileId: string } =>
      Boolean(entry.imageFileId),
  );
  if (attached.length === 0) return [];
  const actor: FileActor = {
    userId: input.userId,
    organizationId: input.organizationId,
    kind: "oauth",
  };
  const files = await loadLiveResources({
    workspaceId: input.workspaceId,
    actor,
    resourceIds: [...new Set(attached.map((entry) => entry.imageFileId))],
  });
  const media = await Promise.all(
    attached.map(async (entry): Promise<CmoCalendarMedia | null> => {
      const file = files.find((item) => item.id === entry.imageFileId);
      const mime = file?.mimeType ?? "";
      const kind = mime.startsWith("video/")
        ? "video"
        : mime.startsWith("image/")
          ? "image"
          : null;
      if (!file || !kind) return null;
      const url = await head(file.sourceId)
        .then((blob) => blob.url)
        .catch(() => null);
      return url ? { entryId: entry.id, kind, url } : null;
    }),
  );
  return media.filter((item): item is CmoCalendarMedia => item !== null);
}
