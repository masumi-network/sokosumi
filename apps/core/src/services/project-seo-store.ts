import { createHash } from "node:crypto";

import type { Prisma } from "@sokosumi/database";

import { lockCalendarScope } from "@/helpers/calendar-locks";
import { badRequest, notFound } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import type { SeoActor, SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import { requireScopedProject } from "@/services/project-social-connections.service";

export const SEO_RESULT_LIMIT = 100;
export const SEO_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
export const SEO_ARTIFACT_TIMEOUT_MS = 20_000;
export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export function normalizeSeoUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw badRequest("Use a public page URL without credentials");
  url.hash = "";
  return url.href;
}
export type SeoWorkspaceActor = Pick<
  SeoActor,
  "workspaceId" | "userId" | "organizationId"
>;

/** Each predicate names both columns. Undefined must never widen an SEO owner. */
export function seoOwnerWhere(actor: Pick<SeoActor, "owner">) {
  return actor.owner.kind === "audit"
    ? { auditId: actor.owner.id, projectId: null }
    : { projectId: actor.owner.id, auditId: null };
}
export const seoOwnerData = seoOwnerWhere;
type SeoOwnerUnique<S extends string, T> =
  | { [K in `projectId_${S}`]: T & { projectId: string } }
  | { [K in `auditId_${S}`]: T & { auditId: string } };

export function seoOwnerUnique<S extends string, T extends object>(
  actor: Pick<SeoActor, "owner">,
  suffix: S,
  fields: T,
): SeoOwnerUnique<S, T> {
  const column = actor.owner.kind === "audit" ? "auditId" : "projectId";
  return {
    [`${column}_${suffix}`]: { [column]: actor.owner.id, ...fields },
  } as SeoOwnerUnique<S, T>;
}

export async function requireSeoWorkspace(
  actor: SeoWorkspaceActor,
  client: Prisma.TransactionClient = prisma,
) {
  const workspace = await client.workspace.findFirst({
    where: {
      id: actor.workspaceId,
      organizationId: actor.organizationId,
      OR: [
        { userId: actor.userId },
        { organization: { members: { some: { userId: actor.userId } } } },
      ],
    },
    select: { id: true },
  });
  if (!workspace) throw notFound("Workspace not found");
  await requireAssignedOrganizationSeat(
    actor.userId,
    actor.organizationId,
    client,
  );
  return workspace;
}
export async function requireSeoOwner(
  actor: SeoActor,
  client: Prisma.TransactionClient = prisma,
  requireOpen = false,
) {
  await requireSeoWorkspace(actor, client);
  if (actor.owner.kind === "audit") {
    const audit = await client.seoAudit.findFirst({
      where: { id: actor.owner.id, workspaceId: actor.workspaceId },
      select: { id: true, projectId: true, name: true },
    });
    if (!audit) throw notFound("SEO audit not found");
    const linkedProject = audit.projectId
      ? await requireScopedProject(
          { projectId: audit.projectId, workspaceId: actor.workspaceId },
          {
            client,
            requireOpen,
            closedMessage: "Cannot change a closing or closed Project",
          },
        )
      : null;
    return {
      id: audit.id,
      auditId: audit.id,
      projectId: audit.projectId,
      name: audit.name,
      websiteUrl: null,
      closingAt: linkedProject?.closingAt ?? null,
      closedAt: linkedProject?.closedAt ?? null,
    };
  }
  const projectActor = {
    projectId: actor.owner.id,
    workspaceId: actor.workspaceId,
  };
  await requireScopedProject(projectActor, {
    client,
    requireOpen,
    closedMessage: "Cannot change a closing or closed Project",
  });
  const project = await client.project.findFirst({
    where: { id: actor.owner.id, workspaceId: actor.workspaceId },
    select: { id: true, websiteUrl: true, closingAt: true, closedAt: true },
  });
  if (!project) throw notFound("Project not found");
  return { ...project, projectId: project.id, auditId: null, name: null };
}
export async function requireLockedSeoOwner(
  client: Prisma.TransactionClient,
  actor: SeoActor,
): Promise<void> {
  const projectIds = actor.owner.kind === "project" ? [actor.owner.id] : [];
  if (
    !(await lockCalendarScope(
      client,
      actor.workspaceId,
      projectIds,
      actor.userId,
    ))
  )
    throw notFound("SEO workspace not found");
  if (actor.owner.kind === "audit") {
    const audit = await client.seoAudit.findFirst({
      where: { id: actor.owner.id, workspaceId: actor.workspaceId },
      select: { projectId: true },
    });
    if (!audit) throw notFound("SEO audit not found");
    if (
      audit.projectId &&
      !(await lockCalendarScope(client, actor.workspaceId, [audit.projectId]))
    )
      throw notFound("Linked Project not found");
    const rows = await client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "seo_audit"
      WHERE id = ${actor.owner.id}::uuid AND "workspaceId" = ${actor.workspaceId}::uuid
      FOR UPDATE
    `;
    if (!rows.length) throw notFound("SEO audit not found");
  }
  await requireSeoOwner(actor, client, true);
}
export async function canReadPrivateSeoMetrics(
  actor: SeoActor,
  client: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  if (!actor.sokoBotId) return true;
  if (actor.privateMetricsAllowed !== true) return false;
  return !!(await client.sokoBot.findFirst({
    where: {
      id: actor.sokoBotId,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      projectId: null,
      archivedAt: null,
      deletedAt: null,
    },
    select: { id: true },
  }));
}
export interface SeoMutationHooks {
  authorize?: (tx: Prisma.TransactionClient) => Promise<void>;
  commit?: (
    tx: Prisma.TransactionClient,
    targetId: string,
    result: unknown,
  ) => Promise<void>;
}
export async function commitSeoMutation<T extends { id: string }>(
  tx: Prisma.TransactionClient,
  result: T,
  hooks: SeoMutationHooks,
): Promise<T> {
  await hooks.commit?.(tx, result.id, result);
  return result;
}
export async function requireSeoPages(
  actor: SeoActor,
  pageIds: string[],
  client: Prisma.TransactionClient = prisma,
) {
  const ids = [...new Set(pageIds)];
  if (!ids.length) throw badRequest("Select at least one page");
  const pages = await client.projectSeoPage.findMany({
    where: { ...seoOwnerWhere(actor), id: { in: ids } },
    orderBy: { createdAt: "asc" },
  });
  if (pages.length !== ids.length)
    throw notFound("A selected page is outside this SEO collection");
  return pages;
}
export async function resolveSeoScope(
  actor: SeoActor,
  input: { scopeId?: string; pageIds?: string[]; pageId?: string },
  client: Prisma.TransactionClient = prisma,
) {
  if (input.scopeId) {
    const scope = await client.projectSeoScope.findFirst({
      where: { id: input.scopeId, ...seoOwnerWhere(actor) },
    });
    if (!scope) throw notFound("SEO page group not found");
    const pages = await requireSeoPages(actor, scope.pageIds, client);
    return {
      id: scope.id,
      name: scope.name,
      version: scope.version,
      pageIds: pages.map((page) => page.id),
      pages,
    };
  }
  const ids = input.pageIds ?? (input.pageId ? [input.pageId] : undefined);
  const pages = ids
    ? await requireSeoPages(actor, ids, client)
    : await client.projectSeoPage.findMany({
        where: seoOwnerWhere(actor),
        orderBy: { createdAt: "asc" },
      });
  return {
    id: null,
    name: input.pageId
      ? "Selected page"
      : input.pageIds
        ? "Selected pages"
        : "All pages",
    version: 0,
    pageIds: pages.map((page) => page.id),
    pages,
  };
}
export function matchesSeoPeriod(at: Date, query: SeoWorkspaceQuery): boolean {
  const date = at.toISOString().slice(0, 10);
  return (!query.from || date >= query.from) && (!query.to || date <= query.to);
}
export function canConfirmSeoCompetitor(value: string): boolean {
  const url = new URL(value);
  return !(
    url.hostname.replace(/^www\./, "") === "google.com" &&
    url.pathname === "/goto"
  );
}
