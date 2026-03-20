/**
 * Get suggestions based on coworker ID
 */

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import type { Coworker } from "@/app/chat/utils/types";
/** DB coworker shape as returned by GET /api/coworkers (and Core GET /v1/coworkers) */
import type { Coworker as CoreCoworker } from "@/lib/clients/generated/core";

const DEFAULT_COWORKER_AVATARS: Record<string, string> = {
  alex: "/images/coworkers/alex.webp",
  elena: "/images/coworkers/elena.webp",
  hannah: "/images/coworkers/hannah.webp",
};

/** Prefer resolvedImageUrl; fallback to static avatar for default coworker ids. */
export function getCoworkerImageUrl(
  idOrSlug: string,
  resolvedImageUrl?: string | null,
): string | null {
  if (resolvedImageUrl != null && resolvedImageUrl !== "") {
    return resolvedImageUrl;
  }
  const key = idOrSlug?.trim().toLowerCase();
  return (key && DEFAULT_COWORKER_AVATARS[key]) ?? null;
}

/**
 * Map a DB coworker to the chat UI Coworker type, resolving profile image (e.g. IPFS) when present.
 * Profile pictures come only from the coworker service (DB image field).
 */
export function mapDbCoworkerToChatCoworker(db: CoreCoworker): Coworker {
  const resolvedImage =
    db.image != null && db.image !== "" ? resolveIpfsOrHttpUrl(db.image) : null;
  return {
    id: db.id,
    slug: db.slug,
    name: db.name,
    description: db.description ?? "",
    useCase: "", // DB has no useCase; avoid duplicating description in UI
    ...(db.caption && { caption: db.caption }),
    ...(resolvedImage && { avatar: resolvedImage }),
  };
}
