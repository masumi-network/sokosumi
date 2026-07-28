/**
 * Get suggestions based on coworker ID
 */

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import type { ChatComposeKind, Coworker } from "@/app/chat/utils/types";
import type { Coworker as CoreCoworker } from "@/lib/clients/generated/core";

export type CoworkerCapability = "chat" | "tasks";

interface CoworkerAvailability {
  capabilities?: readonly CoworkerCapability[];
  archivedAt?: Date | string | null;
  isWhitelisted?: boolean;
  canChat?: boolean;
  baseURL?: string | null;
}

export function coworkerHasCapability(
  coworker: CoworkerAvailability,
  capability: CoworkerCapability,
): boolean {
  return coworker.capabilities?.includes(capability) ?? false;
}

function hasRunnableChatEndpoint(coworker: CoworkerAvailability): boolean {
  return typeof coworker.baseURL === "string" && coworker.baseURL.trim() !== "";
}

function isActiveWhitelistedCoworker(coworker: CoworkerAvailability): boolean {
  return coworker.archivedAt == null && coworker.isWhitelisted !== false;
}

export function coworkerCanChat(coworker: CoworkerAvailability): boolean {
  if (typeof coworker.canChat === "boolean") {
    return coworker.canChat;
  }

  return (
    isActiveWhitelistedCoworker(coworker) &&
    coworkerHasCapability(coworker, "chat") &&
    hasRunnableChatEndpoint(coworker)
  );
}

export function coworkerCanHandleTasks(
  coworker: CoworkerAvailability,
): boolean {
  return (
    isActiveWhitelistedCoworker(coworker) &&
    coworkerHasCapability(coworker, "tasks")
  );
}

export function filterCoworkersForComposeKind(
  coworkers: Coworker[],
  composeKind: ChatComposeKind,
): Coworker[] {
  if (composeKind === "task") {
    return coworkers.filter(coworkerCanHandleTasks);
  }

  return coworkers.filter(coworkerCanChat);
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
    archivedAt: db.archivedAt,
    isWhitelisted: db.isWhitelisted,
    canChat: coworkerCanChat(db),
    metadata: db.metadata,
    ...(db.caption && { caption: db.caption }),
    ...(resolvedImage && { avatar: resolvedImage }),
  };
}
