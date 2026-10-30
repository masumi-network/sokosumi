import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { head } from "@vercel/blob";

import type { FileActor } from "@/lib/files/actor";
import { loadLiveResources } from "@/services/file-search.service";
import type { MarketingStrategyPost } from "@/services/marketing-strategy.service";

export interface CmoCalendarMedia {
  entryId: string;
  kind: "image" | "video";
  url: string;
  /** A carousel's slides in order, the cover first. */
  slides?: string[];
}

/**
 * The image or video Cuso attached to each calendar piece, so the owner sees
 * it in CMO rather than only in Sokosumi's Content Studio. The daily run
 * copies studio media into the owner's Files, a store Social posting already
 * reads from; only files the owner may open, and only images and videos.
 */
export async function cmoCalendarMedia(input: {
  strategy: MarketingStrategyPlan | null;
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
    resourceIds: [
      ...new Set(
        attached.flatMap((entry) => [
          entry.imageFileId,
          ...(entry.slideFileIds ?? []),
        ]),
      ),
    ],
  });
  const blobUrl = async (fileId: string) => {
    const file = files.find((item) => item.id === fileId);
    if (!file?.mimeType?.startsWith("image/")) return null;
    return await head(file.sourceId)
      .then((blob) => blob.url)
      .catch(() => null);
  };
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
      if (!url) return null;
      const slides = (
        await Promise.all((entry.slideFileIds ?? []).map(blobUrl))
      ).filter((slide): slide is string => slide !== null);
      return slides.length > 1
        ? { entryId: entry.id, kind, url, slides }
        : { entryId: entry.id, kind, url };
    }),
  );
  return media.filter((item): item is CmoCalendarMedia => item !== null);
}

/**
 * The image or video on each of the approved version's Social posts: the
 * post's own media, already public in the owner's Files.
 */
export function cmoSocialPostMedia(
  posts: MarketingStrategyPost[],
): CmoCalendarMedia[] {
  return posts.flatMap(({ entry, media }): CmoCalendarMedia[] => {
    const [cover] = media;
    if (!cover) return [];
    const kind = cover.kind === "video" ? "video" : "image";
    return [
      media.length > 1
        ? {
            entryId: entry.id,
            kind,
            url: cover.fileUrl,
            slides: media.map((file) => file.fileUrl),
          }
        : { entryId: entry.id, kind, url: cover.fileUrl },
    ];
  });
}
