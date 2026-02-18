/**
 * Get suggestions based on coworker ID
 */
import type { Coworker } from "@/app/chat/utils/types";
import { ipfsUrlResolver } from "@/lib/ipfs";

export function getCoworkerSuggestions(coworkerId?: string): string[] {
  if (!coworkerId) return [];

  const suggestionMap: Record<string, string[]> = {
    hannah: [
      "How can I analyze data effectively?",
      "What are the best practices for data visualization?",
      "How do I identify trends in my data?",
      "What statistical methods should I use?",
    ],
    john: [
      "How can I improve my code quality?",
      "What are common debugging techniques?",
      "How do I write more maintainable code?",
      "What's the best way to structure my project?",
    ],
  };

  return suggestionMap[coworkerId] || [];
}

/** DB coworker shape as returned by GET /api/coworkers (and Core GET /v1/coworkers) */
export interface DbCoworker {
  id: string;
  slug: string;
  name: string;
  url?: string | null;
  email?: string | null;
  description?: string | null;
  image?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get coworker image URL. Profile pictures come only from the coworker service (DB);
 * when resolvedImageUrl (e.g. from DB/avatar) is provided, return it; otherwise null.
 */
export function getCoworkerImageUrl(
  _idOrSlug: string,
  resolvedImageUrl?: string | null,
): string | null {
  return resolvedImageUrl ?? null;
}

/**
 * Map a DB coworker to the chat UI Coworker type, resolving profile image (e.g. IPFS) when present.
 * Profile pictures come only from the coworker service (DB image field).
 */
export function mapDbCoworkerToChatCoworker(db: DbCoworker): Coworker {
  const resolvedImage =
    db.image != null && db.image !== "" ? ipfsUrlResolver(db.image) : null;
  return {
    id: db.id,
    name: db.name,
    description: db.description ?? "",
    useCase: db.description ?? "",
    ...(db.slug && { slug: db.slug }),
    ...(resolvedImage && { avatar: resolvedImage }),
  };
}
