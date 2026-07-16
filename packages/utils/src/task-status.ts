/**
 * Sōkosumi task lifecycle statuses.
 *
 * Client-safe single source of truth that mirrors the Prisma `TaskStatus`
 * enum in `@sokosumi/database`. Defined here as a const map (not a TS enum,
 * per the repo convention) so consumers — most importantly the web bundle —
 * can reference these values without pulling in `@sokosumi/database`.
 *
 * The Prisma-generated `prisma-client` enum is itself a const map with the
 * same string values, so the two are structurally identical and assignable in
 * both directions. A drift guard test in `@sokosumi/database` asserts they
 * stay in sync.
 */
export const TaskStatus = {
  DRAFT: "DRAFT",
  QUEUED: "QUEUED",
  READY: "READY",
  GRANT_PENDING: "GRANT_PENDING",
  INPUT_REQUIRED: "INPUT_REQUIRED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  OUT_OF_CREDITS: "OUT_OF_CREDITS",
  CREDITS_TOPPED_UP: "CREDITS_TOPPED_UP",
  RUNNING: "RUNNING",
  AWAITING_EXTERNAL: "AWAITING_EXTERNAL",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
