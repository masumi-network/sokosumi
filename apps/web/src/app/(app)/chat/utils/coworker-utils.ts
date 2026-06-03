/**
 * Get suggestions based on coworker ID
 */

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import type { ChatComposeKind, Coworker } from "@/app/chat/utils/types";
import type { Coworker as CoreCoworker } from "@/lib/clients/generated/core";

export type CoworkerCapability = "chat" | "tasks";

export function coworkerHasCapability(
  coworker: Coworker,
  capability: CoworkerCapability,
): boolean {
  return coworker.capabilities?.includes(capability) ?? false;
}

export function filterCoworkersForComposeKind(
  coworkers: Coworker[],
  composeKind: ChatComposeKind,
): Coworker[] {
  const capability: CoworkerCapability =
    composeKind === "task" ? "tasks" : "chat";
  return coworkers.filter((coworker) =>
    coworkerHasCapability(coworker, capability),
  );
}

export const DEFAULT_COWORKER_SLUG = "elena";

export function findCoworkerBySlugOrId(
  coworkers: Coworker[],
  slugOrId: string,
): Coworker | null {
  const normalized = slugOrId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    coworkers.find((coworker) => coworker.slug?.toLowerCase() === normalized) ??
    coworkers.find((coworker) => coworker.id.toLowerCase() === normalized) ??
    null
  );
}

export function findDefaultCoworker(
  coworkers: Coworker[],
  preferredSlug: string = DEFAULT_COWORKER_SLUG,
): Coworker | null {
  const preferred = findCoworkerBySlugOrId(coworkers, preferredSlug);
  if (preferred) {
    return preferred;
  }
  return coworkers[0] ?? null;
}

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
    capabilities: [...db.capabilities],
    metadata: db.metadata,
    ...(db.caption && { caption: db.caption }),
    ...(resolvedImage && { avatar: resolvedImage }),
  };
}
