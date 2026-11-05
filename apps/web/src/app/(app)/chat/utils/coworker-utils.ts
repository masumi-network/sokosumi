import type { Coworker as CoreCoworker } from "@sokosumi/core-client";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import type { Coworker } from "@/app/chat/utils/types";

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

/**
 * Active (not archived) only. Workspace usability (global whitelist ∪
 * GRANTED early access) is owned by Core `scope=available` /
 * `validateChatCoworkerIds` — do not re-gate on isWhitelisted here or
 * pilot coworkers vanish from channel/task pickers.
 */
function isActiveCoworker(coworker: CoworkerAvailability): boolean {
  return coworker.archivedAt == null;
}

export function coworkerCanChat(coworker: CoworkerAvailability): boolean {
  if (typeof coworker.canChat === "boolean") {
    return coworker.canChat;
  }

  return (
    isActiveCoworker(coworker) &&
    coworkerHasCapability(coworker, "chat") &&
    hasRunnableChatEndpoint(coworker)
  );
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
    priority: db.priority,
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
