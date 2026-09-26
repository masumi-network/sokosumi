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

export function resolveFileActor(userContext: UserContext): FileActor {
  if (userContext.source === "context") {
    return {
      userId: userContext.userId,
      organizationId: userContext.organizationId,
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
    organizationId: userContext.organizationId,
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
