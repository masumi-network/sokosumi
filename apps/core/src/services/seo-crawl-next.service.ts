import type { Prisma } from "@sokosumi/database";
import { seoTaskDescription } from "@sokosumi/utils";
import { z } from "zod";
import { getEnv } from "@/config/env";
import { conflict, notFound } from "@/helpers/error";
import { reportObject } from "@/helpers/project-seo-public-report";
import { crawlContinuationTip } from "@/helpers/seo-crawl-next-report";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  findSeoAnalysisExecutor,
  requireSeoAnalysisDispatch,
} from "@/lib/seo/analysis-dispatch";
import { requireSeoAnalysisBalance } from "@/lib/seo/analysis-price";
import { fullAuditBillingContext } from "@/lib/seo/audit-settlement";
import type { SeoActor, SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import type { RequestSeoCrawlNext } from "@/schemas/seo-audit-price.schema";
import { seoSiteCrawlSchema } from "@/schemas/seo-site-crawl.schema";
import { isCmoProject, requireNotCmoProject } from "./cmo-cuso.service";
import { requireNoActiveSeoAnalysis } from "./project-seo-analysis-concurrency";
import {
  commitSeoMutation,
  normalizeSeoUrl,
  requireLockedSeoOwner,
  requireSeoOwner,
  resolveSeoScope,
  SEO_EVIDENCE_ORDER,
  SEO_WORKSPACE_EVIDENCE_LIMIT,
  type SeoMutationHooks,
  seoOwnerUnique,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import { requireLockedOpenProject } from "./project-social-connections.service";
import { createTaskForActor } from "./task-domain.service";

const CRAWLED_KINDS = ["audit_full", "crawl_next"];
/** The observations the tip reads: a chain longer than this is past what any owner pays for. */
const MAX_CRAWLS = 200;
const PAGE_URLS = z.array(z.string());
const RETRY = "The crawl request changed. Retry with the same key.";
/**
 * How long a completed continuation's Report may take to arrive. Until it does, the chain still ends at its parent,
 * so a second request would buy the same pages again. Past both, Sokosumi takes the Report as lost. The first is
 * Web's wait for a check that does not end (SEO_CHECK_STALE_MS), so Web shows no trigger that Core refuses.
 */
const CHECK_WAIT_MS = 3 * 60 * 60_000;
const REPORT_WAIT_MS = 15 * 60_000;

export function isSeoCrawlNextEnabled(): boolean {
  return getEnv().SEO_CRAWL_NEXT_ENABLED;
}

/** The crawls of this audit or Project, newest first, as the tip reads them. */
export async function readSeoCrawls(
  tx: Pick<Prisma.TransactionClient, "projectSeoObservation">,
  actor: Pick<SeoActor, "owner">,
) {
  const rows = await tx.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: { in: CRAWLED_KINDS },
      ownerId: null,
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_CRAWLS,
    select: { id: true, kind: true, payload: true },
  });
  return rows.map((row) => {
    const payload = reportObject(row.payload);
    return {
      id: row.id,
      kind: row.kind,
      siteCrawl: seoSiteCrawlSchema.safeParse(payload?.siteCrawl).data,
      pageUrls: PAGE_URLS.safeParse(payload?.pageUrls).data ?? [],
    };
  });
}

/** The crawl a continuation goes on from, with the full audit it starts at. */
async function readCrawlTip(
  tx: Pick<Prisma.TransactionClient, "projectSeoObservation">,
  actor: Pick<SeoActor, "owner">,
) {
  const rows = await readSeoCrawls(tx, actor);
  const tip = crawlContinuationTip(rows);
  const root = rows.find((row) => row.kind === "audit_full");
  return tip && root ? { ...tip, rootId: root.id } : null;
}

/**
 * Whether the full audit is in the evidence the workspace loads for these pages, with a place left for the
 * continuation's own row: a full audit past it has no ledger to show the result in.
 */
async function rootInLedger(
  tx: Pick<Prisma.TransactionClient, "projectSeoObservation">,
  actor: Pick<SeoActor, "owner">,
  pageIds: string[],
  rootId: string,
) {
  const rows = await tx.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      ownerId: null,
      pageIds: { hasSome: pageIds },
    },
    orderBy: SEO_EVIDENCE_ORDER,
    take: SEO_WORKSPACE_EVIDENCE_LIMIT - 1,
    select: { id: true },
  });
  return rows.some((row) => row.id === rootId);
}

/** The sale refuses the audit of a CMO Project (requireNotCmoProject), so the offer does too. */
async function ownedByCmo(actor: SeoActor) {
  const { projectId } = await requireSeoOwner(actor);
  return projectId ? await isCmoProject(projectId) : false;
}

/** The workspace projection's dispatch inputs: what the SEO check service runs here, and the crawl a continuation goes on from. */
export async function seoDispatchInputs(
  actor: SeoActor,
  executor: Awaited<ReturnType<typeof findSeoAnalysisExecutor>>,
  view: {
    query: Pick<SeoWorkspaceQuery, "to">;
    /** The pages the view shows. */
    scope: { pages: readonly { url: string }[] };
    /** Every page of the owner: the sale reads the crawl's ledger over all of them. */
    pages: readonly { id: string }[];
  },
) {
  const tip =
    executor?.canUsePaidSearchData && isSeoCrawlNextEnabled()
      ? await readCrawlTip(prisma, actor)
      : null;
  // The continuation's Task and result link only to its start page: a view without that page could not show them.
  const shown =
    tip &&
    // A view that ends at a date would hide the continuation's result.
    !view.query.to &&
    view.scope.pages.some(
      (page) => page.url === normalizeSeoUrl(tip.startUrl),
    ) &&
    !(await crawlArriving(prisma, actor)) &&
    (await rootInLedger(
      prisma,
      actor,
      view.pages.map((page) => page.id),
      tip.rootId,
    )) &&
    !(await ownedByCmo(actor));
  return {
    analysisDispatchEnabled: executor !== null,
    canUsePaidSearchData: executor?.canUsePaidSearchData === true,
    canSchedule: executor?.canSchedule === true,
    continueCrawlFrom: shown ? tip.snapshotId : null,
  };
}

/**
 * A Task that crawls the next pages of the newest full audit's crawl, or of the newest continuation of it, and
 * audits the problem pages it finds. It charges once at completion, at cost plus 50%, at least 100 credits.
 */
export async function requestSeoCrawlNext(
  actor: SeoActor,
  input: RequestSeoCrawlNext,
  hooks: SeoMutationHooks = {},
) {
  if (!isSeoCrawlNextEnabled())
    throw notFound("Crawl continuations are not available");
  requireSeoAnalysisDispatch();
  const requestHash = sha256(JSON.stringify(input));
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await hooks.authorize?.(tx);
    const previous = await tx.projectSeoAnalysis.findUnique({
      where: seoOwnerUnique(actor, "idempotencyKey", {
        idempotencyKey: input.idempotencyKey,
      }),
    });
    if (previous) {
      if (
        previous.requestHash !== requestHash ||
        previous.requestedBy !== actor.userId
      )
        throw conflict(
          "This analysis key was already used for another request",
        );
      return commitSeoMutation(tx, previous, hooks);
    }
    await requireNoActiveSeoAnalysis(tx, actor);
    if (await crawlArriving(tx, actor))
      throw conflict(
        "The last crawl of the next pages has not arrived yet. Wait until it shows, then start the next one.",
      );
    const tip = await readCrawlTip(tx, actor);
    if (!tip)
      throw conflict(
        "This crawl cannot go on: it read the whole site, or it stopped at a limit that a continuation does not lift.",
      );
    if (tip.snapshotId !== input.continues)
      throw conflict(
        "A newer crawl goes on from this one. Reload the crawl and start from the newest.",
      );
    const executor = await findSeoAnalysisExecutor(actor, tx);
    if (!executor)
      throw conflict("The SEO check service is unavailable in this workspace");
    if (!executor.canUsePaidSearchData)
      throw conflict(
        "Paid search data is unavailable for this SEO check service",
      );
    const owner = await requireSeoOwner(actor, tx);
    if (owner.projectId) {
      await requireLockedOpenProject(tx, {
        projectId: owner.projectId,
        workspaceId: actor.workspaceId,
      });
      // The Project route's lock does not see a request through the audit.
      await requireNotCmoProject(owner.projectId, actor.workspaceId, tx);
    }
    await requireSeoAnalysisBalance(
      tx,
      {
        userId: actor.userId,
        organizationId: actor.organizationId,
        projectId: owner.projectId,
      },
      input.price.minimumCredits,
    );
    const scope = await resolveSeoScope(actor, {}, tx);
    const startUrl = normalizeSeoUrl(tip.startUrl);
    const page = scope.pages.find((row) => row.url === startUrl);
    if (!page)
      throw conflict(
        "The crawl's start page is no longer in this audit. Add it again to go on with the crawl.",
      );
    if (!(await rootInLedger(tx, actor, scope.pageIds, tip.rootId)))
      throw conflict(
        "The crawl's full audit is older than the history Sokosumi shows. Run a new full audit to crawl further.",
      );
    // The SEO bot's seo_crawl_next line: exactly these keys.
    const packet: Prisma.InputJsonObject = {
      version: 1,
      url: tip.startUrl,
      continues: tip.snapshotId,
      price: input.price,
    };
    const analysis = await tx.projectSeoAnalysis.create({
      data: {
        ...seoOwnerWhere(actor),
        idempotencyKey: input.idempotencyKey,
        requestHash,
        kind: "crawl_next",
        pageIds: [page.id],
        scopeVersion: scope.version,
        request: packet,
        requestedBy: actor.userId,
      },
    });
    const task = await createTaskForActor(
      {
        actor: actor.sokoBotId
          ? { kind: "soko_bot", sokoBotId: actor.sokoBotId }
          : { kind: "user", userId: actor.userId },
        ownerId: actor.userId,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        projectId: owner.projectId,
        name: "SEO crawl of the next pages",
        description: seoTaskDescription(
          `Crawl the next pages of ${tip.startUrl} and audit the problem pages the crawl finds.`,
          "seo_crawl_next",
          packet,
        ),
        assigneeId: executor.coworkerId,
        status: "READY",
        visibility: "PUBLIC",
      },
      tx,
    );
    const result = await tx.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: {
        taskId: task.id,
        request: {
          ...packet,
          fullAuditBillingContext: fullAuditBillingContext(task),
        },
        failureReason:
          task.status === "GRANT_PENDING"
            ? "The source Task awaits Workspace Vendor approval"
            : null,
      },
    });
    return commitSeoMutation(tx, result, hooks);
  }, RETRY);
}

/** Whether a completed continuation's Report has not imported yet: its crawl is not yet the chain's tip. */
async function crawlArriving(
  tx: Pick<Prisma.TransactionClient, "projectSeoAnalysis" | "task">,
  actor: Pick<SeoActor, "owner">,
) {
  const now = Date.now();
  const waiting = await tx.projectSeoAnalysis.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: "crawl_next",
      // A rejected Report fails the analysis, yet the corrected Report can still arrive.
      status: { not: "completed" },
      taskId: { not: null },
    },
    select: { taskId: true, createdAt: true },
  });
  const young = new Set(
    waiting.flatMap((row) =>
      row.taskId && row.createdAt.getTime() > now - CHECK_WAIT_MS
        ? [row.taskId]
        : [],
    ),
  );
  const taskIds = waiting.flatMap((row) => (row.taskId ? [row.taskId] : []));
  if (!taskIds.length) return false;
  const completed = await tx.task.findMany({
    where: { id: { in: taskIds }, status: "COMPLETED", archivedAt: null },
    select: { id: true, updatedAt: true },
  });
  return completed.some(
    (task) =>
      young.has(task.id) || task.updatedAt.getTime() > now - REPORT_WAIT_MS,
  );
}
