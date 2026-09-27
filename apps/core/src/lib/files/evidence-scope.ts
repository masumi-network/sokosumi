import { createHash } from "node:crypto";

import {
  FileSourceKind,
  FileSourceScope,
  type Prisma,
  TaskVisibility,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";

import prisma from "@/lib/db/prisma";
import type { FileActor, FileActorKind } from "@/lib/files/actor";

/**
 * An evidence scope is an authorization predicate over a canonical source.
 * Every derived field — a tag, a snippet, a related edge, an ordering signal —
 * carries the scope of the evidence it came from, and a reader only ever sees
 * a field whose scope admits them *now*.
 *
 * The catalog is a ceiling, never a grant. A scope can only narrow what the
 * canonical source already allows, and an unimplemented source × actor
 * combination resolves to nothing rather than to "probably fine".
 */

export interface EvidenceScopeKey {
  workspaceId: string;
  sourceKind: FileSourceKind;
  sourceScope: FileSourceScope;
  sourceId: string;
}

/** Actor kinds each source admits at all. Anything absent fails closed. */
const SOURCE_ACTOR_CEILING: Record<FileSourceKind, FileActorKind[]> = {
  [FileSourceKind.DRIVE_UPLOAD]: [
    "interactive",
    "api_key",
    "oauth",
    "coworker",
  ],
  [FileSourceKind.TASK_OUTPUT]: ["interactive", "api_key", "oauth", "coworker"],
  [FileSourceKind.PROJECT_DOCUMENT]: ["interactive"],
  [FileSourceKind.NATIVE_TABLE]: ["interactive"],
  // Studio is interactive-only in v1 and exposes no derived field at all to
  // any other actor kind — not a caption, not a score, not a facet count.
  [FileSourceKind.STUDIO_ASSET]: ["interactive"],
};

export function sourceKindsForActor(
  actorKind: FileActorKind,
): FileSourceKind[] {
  return (Object.keys(SOURCE_ACTOR_CEILING) as FileSourceKind[]).filter(
    (kind) => SOURCE_ACTOR_CEILING[kind].includes(actorKind),
  );
}

export function sourceAdmitsActorKind(
  sourceKind: FileSourceKind,
  actorKind: FileActorKind,
): boolean {
  return SOURCE_ACTOR_CEILING[sourceKind].includes(actorKind);
}

export async function ensureEvidenceScope(
  key: EvidenceScopeKey,
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string; scopeVersion: number }> {
  const existing = await client.fileEvidenceScope.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: key.workspaceId,
        sourceKind: key.sourceKind,
        sourceScope: key.sourceScope,
        sourceId: key.sourceId,
      },
    },
    select: { id: true, scopeVersion: true },
  });
  if (existing) return existing;

  return client.fileEvidenceScope.create({
    data: {
      workspaceId: key.workspaceId,
      sourceKind: key.sourceKind,
      sourceScope: key.sourceScope,
      sourceId: key.sourceId,
      actorKinds: SOURCE_ACTOR_CEILING[key.sourceKind],
    },
    select: { id: true, scopeVersion: true },
  });
}

/**
 * `scopeVersion` is written once and never advanced. Read this before
 * relying on it.
 *
 * There used to be an `advanceEvidenceScopeVersion` helper here, and three
 * comments across the feature described a scope-invalidation layer built on
 * it. Nothing ever called it, so the layer did not exist: the
 * `fes.scopeVersion = fc.scopeVersion` join in retrieval never excluded a
 * row, and `resolveScopeEpoch`'s sum and max components could only change
 * when a scope row was added.
 *
 * The helper is deleted rather than wired, deliberately. Wiring it means
 * calling it from every canonical mutation that changes who may read a
 * store *and* adding the scope predicate to the label, project and hydrate
 * queries — real work, and a half-wired version would be worse than none
 * because it would look enforced.
 *
 * Nothing is unprotected in the meantime. Authorization is re-evaluated from
 * the canonical source on every read: `loadLiveResources` runs on every
 * page, and the task-visibility and membership checks are live SQL. What is
 * missing is a defence-in-depth layer, not the defence.
 */

/**
 * The authorization predicate, as SQL, over `file_resource fr` joined to its
 * `file_evidence_scope fes`. Retrieval applies this *before* any limit, so a
 * budget can only ever return fewer authorized rows — never a wider scope.
 *
 * Each arm restates the canonical gate rather than trusting a catalog column:
 * a personal store belongs to its owner, an organization store to a member of
 * the active organization, and a task output follows current task visibility.
 */
export function buildAuthorizedResourceSql(input: {
  workspaceId: string;
  actor: FileActor;
}): PrismaRaw.Sql {
  const { workspaceId, actor } = input;
  const admittedKinds = sourceKindsForActor(actor.kind);

  if (admittedKinds.length === 0) {
    return PrismaRaw.sql`FALSE`;
  }

  const arms: PrismaRaw.Sql[] = [];

  if (
    admittedKinds.includes(FileSourceKind.DRIVE_UPLOAD) &&
    actor.organizationId === null
  ) {
    arms.push(PrismaRaw.sql`(
      fr."sourceKind" = ${FileSourceKind.DRIVE_UPLOAD}::"FileSourceKind"
      AND fr."sourceScope" = ${FileSourceScope.USER}::"FileSourceScope"
      AND fr."ownerUserId" = ${actor.userId}
    )`);
  }

  if (
    admittedKinds.includes(FileSourceKind.DRIVE_UPLOAD) &&
    actor.organizationId !== null
  ) {
    arms.push(PrismaRaw.sql`(
      fr."sourceKind" = ${FileSourceKind.DRIVE_UPLOAD}::"FileSourceKind"
      AND fr."sourceScope" = ${FileSourceScope.ORGANIZATION}::"FileSourceScope"
      AND fr."ownerOrganizationId" = ${actor.organizationId}
      AND EXISTS (
        SELECT 1 FROM member m
        WHERE m."organizationId" = ${actor.organizationId}
          AND m."userId" = ${actor.userId}
      )
    )`);
  }

  if (admittedKinds.includes(FileSourceKind.TASK_OUTPUT)) {
    arms.push(PrismaRaw.sql`(
      fr."sourceKind" = ${FileSourceKind.TASK_OUTPUT}::"FileSourceKind"
      AND EXISTS (
        SELECT 1 FROM task t
        WHERE t.id = fr."sourceTaskId"
          AND t."workspaceId" = fr."workspaceId"
          AND t."archivedAt" IS NULL
          AND (
            t.visibility = ${TaskVisibility.PUBLIC}::"TaskVisibility"
            OR (
              t.visibility = ${TaskVisibility.PRIVATE}::"TaskVisibility"
              AND t."ownerId" = ${actor.userId}
            )
          )
      )
    )`);
  }

  if (arms.length === 0) {
    return PrismaRaw.sql`FALSE`;
  }

  return PrismaRaw.sql`(
    fr."workspaceId" = ${workspaceId}::uuid
    AND fr.lifecycle = 'ACTIVE'::"FileResourceLifecycle"
    AND fr."tombstonedAt" IS NULL
    AND (${PrismaRaw.join(arms, " OR ")})
  )`;
}

/**
 * A digest of every authorization clock this actor's view depends on. A
 * ranked session pins it; when it changes, the session restarts instead of
 * paging on through an order that was built under different access.
 */
export async function resolveScopeEpoch(input: {
  workspaceId: string;
  actor: FileActor;
  client?: Prisma.TransactionClient;
}): Promise<string> {
  const client = input.client ?? prisma;
  const kinds = sourceKindsForActor(input.actor.kind);

  const rows = await client.fileEvidenceScope.aggregate({
    where: { workspaceId: input.workspaceId, sourceKind: { in: kinds } },
    _count: { _all: true },
    _sum: { scopeVersion: true },
    _max: { scopeVersion: true },
  });

  return createHash("sha256")
    .update(input.workspaceId)
    .update("\0")
    .update(input.actor.userId)
    .update("\0")
    .update(input.actor.organizationId ?? "")
    .update("\0")
    .update(input.actor.kind)
    .update("\0")
    .update(String(rows._count._all))
    .update("\0")
    .update(String(rows._sum.scopeVersion ?? 0))
    .update("\0")
    .update(String(rows._max.scopeVersion ?? 0))
    .digest("base64url");
}
