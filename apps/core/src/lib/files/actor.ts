import { createHash } from "node:crypto";

import type { UserContext } from "@/middleware/auth";

/**
 * Which canonical gate an actor can pass at all. Studio, for one, admits
 * only an interactive session in v1, so the adapter has to be able to say
 * "this actor kind is not eligible" before any row is read.
 */
export type FileActorKind =
  | "interactive"
  | "api_key"
  | "oauth"
  | "coworker"
  | "soko_bot"
  | "worker";

export interface FileActor {
  userId: string;
  /** Active workspace organization, or null for the personal workspace. */
  organizationId: string | null;
  kind: FileActorKind;
}

/**
 * Build the actor a Files query runs as.
 *
 * `organizationId` is **the store this request resolved to**, not whatever
 * the caller's session happens to have active. Taking the session's value
 * was wrong in both directions:
 *
 * - An API-key or OAuth caller has no active organization — those contexts
 *   are always built with `organizationId: null` — so the organization arm
 *   of the authorized relation never fired and an authorized integration
 *   saw an empty organization Drive. It failed closed, so nothing leaked,
 *   but "my files are gone" is still the wrong answer.
 * - A session user *with* an active organization asking for their personal
 *   drive got the mirror of it: the personal arm requires a null
 *   organization, so it did not fire either.
 *
 * The caller passes the scope it has already authorized through
 * `requireDriveFileAccess`, and the SQL still re-checks membership, so this
 * narrows the query to the right store without widening what may be read.
 */
export function resolveFileActor(
  userContext: UserContext,
  scope?: { organizationId: string | null },
): FileActor {
  const organizationId = scope
    ? scope.organizationId
    : userContext.organizationId;

  if (userContext.source === "context") {
    return {
      userId: userContext.userId,
      organizationId,
      kind: "coworker",
    };
  }

  const method = userContext.authenticationMethod;
  const kind: FileActorKind =
    method === "api_key"
      ? "api_key"
      : method === "oauth"
        ? "oauth"
        : "interactive";

  return {
    userId: userContext.userId,
    organizationId,
    kind,
  };
}

/**
 * Stable identity for cache keys and the admission audit. Hashed so neither a
 * user id nor an organization id lands in a log line or a cache key that gets
 * printed; distinct actors still get distinct keys.
 */
export function fileActorFingerprint(
  actor: FileActor,
  workspaceId: string,
): string {
  return createHash("sha256")
    .update(workspaceId)
    .update("\0")
    .update(actor.userId)
    .update("\0")
    .update(actor.organizationId ?? "")
    .update("\0")
    .update(actor.kind)
    .digest("base64url");
}
