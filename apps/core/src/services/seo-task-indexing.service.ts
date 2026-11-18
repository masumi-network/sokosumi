import { z } from "@hono/zod-openapi";
import { getEnv } from "@/config/env";
import {
  conflict,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import prisma, { type DbClient } from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { googleReturnedUnknown } from "@/lib/seo/inspection-provenance";
import {
  GSC_INSPECT_TOOL,
  gscInspectionArguments,
} from "@/lib/seo/native-gsc-inspection";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import {
  normalizeGscTaskInspection,
  unavailableGscTaskInspection,
} from "@/lib/seo/native-gsc-task-inspection";
import {
  bindSeoToolArguments,
  GSC_PROPERTIES_TOOL,
  type SeoNativeTool,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type SeoTaskIndexingReceipt,
  type SeoTaskIndexingResultRequest,
  seoTaskIndexingResultSchema,
} from "@/schemas/seo-task-indexing.schema";
import type { TaskWorkerContext } from "@/schemas/task-worker-context.schema";
import {
  listIntegrationTools,
  readIntegrationTool,
} from "./composio-integration-tools.service";
import { seoOwnerData, seoOwnerUnique, sha256 } from "./project-seo-store";
import {
  assertSameSeoTaskIndexingContext,
  readSeoTaskIndexingContext,
  requireSeoTaskIndexingContext,
  type SeoTaskIndexingContext,
} from "./seo-task-indexing-context";
import {
  hasSavedSeoIndexingAssessment,
  persistedReceiptSchema,
  type StoredReceipt,
  storedReceiptSchema,
} from "./seo-task-indexing-receipt";

export { hasSavedSeoIndexingAssessment } from "./seo-task-indexing-receipt";

import { syncLockService } from "./sync-lock.service";

export const SEO_INDEXING_FRESH_MS = 24 * 60 * 60 * 1000;
const SEO_INDEXING_RETRY_MS = 60 * 60 * 1000;
/** Older receipts did not distinguish a missing provider answer from Google's explicit unknown verdict. */
function shouldRetryInspection({
  receipt,
  propertyId,
  providerAnsweredAll,
}: StoredReceipt) {
  if (providerAnsweredAll) return false;
  if (!propertyId) return receipt.status === "unavailable";
  return receipt.pages.some(
    (page) =>
      page.verdict === "VERDICT_UNSPECIFIED" &&
      gscPropertyCovers(propertyId, [page.pageUrl]),
  );
}

const receiptKey = (context: SeoTaskIndexingContext) =>
  `task-indexing:${context.taskId}:${context.contextFingerprint}`;

function fresh(checkedAt: string, lifetime: number) {
  const age = Date.now() - Date.parse(checkedAt);
  return age >= 0 && age < lifetime;
}

function currentReceipt(saved: StoredReceipt) {
  const { receipt } = saved;
  const partial =
    receipt.status !== "available" ||
    receipt.pages.some((page) => page.verdict === "VERDICT_UNSPECIFIED");
  return (
    fresh(
      receipt.checkedAt,
      partial ? SEO_INDEXING_RETRY_MS : SEO_INDEXING_FRESH_MS,
    ) &&
    Object.values(saved.reusedCheckedAt ?? {}).every((at) =>
      fresh(at, SEO_INDEXING_FRESH_MS),
    )
  );
}

async function savedReceipt(
  context: SeoTaskIndexingContext,
  client: DbClient = prisma,
) {
  const saved = await client.projectSeoObservation.findUnique({
    where: seoOwnerUnique(context.actor, "sourceKey", {
      sourceKey: receiptKey(context),
    }),
  });
  if (
    !saved ||
    saved.ownerId !== context.actor.userId ||
    saved.visibility !== "PRIVATE" ||
    saved.kind !== "index_inspection" ||
    saved.source !== "search_console" ||
    saved.sourceTaskId !== context.taskId
  )
    return null;
  const parsed = storedReceiptSchema.safeParse(saved.payload);
  if (
    !parsed.success ||
    parsed.data.contextFingerprint !== context.contextFingerprint
  )
    return null;
  const receipt = parsed.data.receipt;
  if (
    receipt.taskId !== context.taskId ||
    (receipt.auditPageUrl ?? context.pageUrls[0]) !== context.auditPageUrl ||
    receipt.receiptHash !== saved.artifactHash ||
    receipt.pages.length !== context.inspectionPageUrls.length ||
    new Set(receipt.pages.map((page) => page.pageUrl)).size !==
      context.inspectionPageUrls.length ||
    receipt.pages.some(
      (page) => !context.inspectionPageUrls.includes(page.pageUrl),
    )
  )
    return null;
  return fresh(receipt.checkedAt, SEO_INDEXING_FRESH_MS) ? parsed.data : null;
}

function makeReceipt(
  context: SeoTaskIndexingContext,
  data: Omit<SeoTaskIndexingReceipt, "receiptHash" | "assessmentSaved">,
  propertyId: string | null,
  reusedCheckedAt?: Record<string, string>,
): StoredReceipt {
  return {
    contextFingerprint: context.contextFingerprint,
    propertyId,
    ...(reusedCheckedAt && { reusedCheckedAt }),
    receipt: persistedReceiptSchema.parse({
      ...data,
      receiptHash: sha256(
        JSON.stringify({
          context: context.contextFingerprint,
          propertyId,
          ...(reusedCheckedAt && { reusedCheckedAt }),
          ...data,
        }),
      ),
    }),
  };
}

async function collect(
  context: SeoTaskIndexingContext,
): Promise<StoredReceipt> {
  const base = {
    version: 1 as const,
    taskId: context.taskId,
    auditPageUrl: context.auditPageUrl,
    checkedAt: new Date().toISOString(),
    pages: context.inspectionPageUrls.map(unavailableGscTaskInspection),
  };
  const integration = context.integration;
  const previous = await savedReceipt(context);
  const saved = previous && currentReceipt(previous) ? previous : null;
  if (!integration)
    return (
      saved ?? makeReceipt(context, { ...base, status: "not_connected" }, null)
    );
  try {
    const tools = await listIntegrationTools(integration, { limit: 100 });
    const toolFor = (slug: string): SeoNativeTool => {
      const tool = tools.find((candidate) => candidate.slug === slug);
      if (!tool?.readOnly || !tool.inputSchema)
        throw unprocessableEntity(
          "The connected toolkit has no supported read-only indexing tool",
        );
      return tool;
    };
    const read = async (
      tool: SeoNativeTool,
      logical: Record<string, unknown>,
    ) =>
      readIntegrationTool(
        integration,
        tool.slug,
        bindSeoToolArguments(tool, logical),
      );
    // Verify current property permission before serving even a cached inspection.
    const sites = z
      .object({
        siteEntry: z
          .array(
            z.object({
              siteUrl: z.string().max(500),
              permissionLevel: z.string(),
            }),
          )
          .max(1000)
          .default([]),
      })
      .parse(
        unwrapNativeStatistics(await read(toolFor(GSC_PROPERTIES_TOOL), {}), [
          "siteEntry",
        ]),
      );
    const properties = [
      ...new Set(
        sites.siteEntry
          .filter(
            (site) =>
              ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(
                site.permissionLevel,
              ) && gscPropertyCovers(site.siteUrl, context.pageUrls),
          )
          .map((site) => site.siteUrl),
      ),
    ];
    const property =
      context.selectedProperty && properties.includes(context.selectedProperty)
        ? context.selectedProperty
        : properties.length === 1
          ? properties[0]
          : null;
    if (!property)
      return saved?.receipt.status === "needs_property"
        ? saved
        : makeReceipt(context, { ...base, status: "needs_property" }, null);
    if (
      saved?.propertyId === property &&
      ["available", "unavailable"].includes(saved.receipt.status)
    )
      return saved;
    const inspectionTool = toolFor(GSC_INSPECT_TOOL);
    const retained = new Map(
      previous?.propertyId === property
        ? previous.receipt.pages.flatMap((page) => {
            const at =
              previous.reusedCheckedAt?.[page.pageUrl] ??
              previous.receipt.checkedAt;
            return page.verdict !== "VERDICT_UNSPECIFIED" &&
              gscPropertyCovers(property, [page.pageUrl]) &&
              fresh(at, SEO_INDEXING_FRESH_MS)
              ? [[page.pageUrl, { page, at }] as const]
              : [];
          })
        : [],
    );
    const results = await Promise.allSettled(
      context.inspectionPageUrls.map(async (pageUrl) =>
        !gscPropertyCovers(property, [pageUrl])
          ? unavailableGscTaskInspection(pageUrl)
          : (retained.get(pageUrl)?.page ??
            normalizeGscTaskInspection(
              pageUrl,
              unwrapNativeStatistics(
                await read(
                  inspectionTool,
                  gscInspectionArguments(property, pageUrl),
                ),
                ["inspectionResult"],
              ),
            )),
      ),
    );
    const pages = results.map((result, index) =>
      result.status === "fulfilled" ? result.value : base.pages[index]!,
    );
    const collected = makeReceipt(
      context,
      {
        ...base,
        status: pages.some((page) => page.verdict !== "VERDICT_UNSPECIFIED")
          ? "available"
          : "unavailable",
        pages,
      },
      property,
      retained.size
        ? Object.fromEntries([...retained].map(([url, item]) => [url, item.at]))
        : undefined,
    );
    // Preserve the legacy storage shape unless Google's explicit unknown would look like a failed read.
    if (
      results.every((result) => result.status === "fulfilled") &&
      shouldRetryInspection(collected)
    ) {
      collected.providerAnsweredAll = true;
    } else if (results.some((result) => result.status === "rejected")) {
      // A mixed batch cannot use the receipt-wide marker. Record only the unknowns Google actually returned.
      const answered = results.flatMap((result) =>
        result.status === "fulfilled" &&
        result.value.verdict === "VERDICT_UNSPECIFIED" &&
        gscPropertyCovers(property, [result.value.pageUrl])
          ? [result.value.pageUrl]
          : [],
      );
      if (answered.length) collected.answeredUnknownPageUrls = answered;
    }
    return collected;
  } catch {
    // Upstream failures can contain account data. No raw error crosses the Task boundary.
    if (
      previous?.receipt.pages.some(
        (page) => page.verdict !== "VERDICT_UNSPECIFIED",
      )
    )
      throw serviceUnavailable(
        "Could not confirm Google access. Retry this indexing check.",
      );
    return makeReceipt(context, { ...base, status: "unavailable" }, null);
  }
}

async function withRetainedAssessments(
  payload: StoredReceipt,
  context: SeoTaskIndexingContext,
  tx: DbClient,
) {
  if (!payload.reusedCheckedAt) return payload;
  const previous = await savedReceipt(context, tx);
  if (
    !previous ||
    previous.propertyId !== payload.propertyId ||
    previous.receipt.receiptHash === payload.receipt.receiptHash
  )
    return payload;
  const row = await tx.projectSeoObservation.findUnique({
    where: seoOwnerUnique(context.actor, "sourceKey", {
      sourceKey: `task-index-triage:${context.taskId}:${previous.receipt.receiptHash}`,
    }),
  });
  const assessments =
    row &&
    hasSavedSeoIndexingAssessment(
      row,
      previous.receipt,
      context.actor.userId,
      context.auditPageUrl,
    )
      ? seoTaskIndexingResultSchema.parse(row.payload).assessments
      : previous.retainedAssessments;
  // Keep earlier observations through repeated partial reads, including a lost result submission.
  const retained = assessments?.filter((page) => {
    const original =
      previous.reusedCheckedAt?.[page.pageUrl] ?? previous.receipt.checkedAt;
    return (
      page.status !== "unavailable" &&
      payload.reusedCheckedAt?.[page.pageUrl] === original
    );
  });
  return retained?.length
    ? { ...payload, retainedAssessments: retained }
    : payload;
}

/** Only the Task's fixed pages are read. All provider I/O is outside database transactions. */
export async function readSeoTaskIndexing(
  auth: AuthenticationContext,
  taskId: string,
  expected: TaskWorkerContext,
  auditPageUrlHint?: string,
): Promise<{ receipt: SeoTaskIndexingReceipt; retryable: boolean }> {
  const context = await readSeoTaskIndexingContext(
    auth,
    taskId,
    expected,
    auditPageUrlHint,
  );
  const key = `seo-task-indexing:${taskId}:${context.contextFingerprint}`;
  const lock = await syncLockService
    .acquireLock(key)
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "LOCK_IS_LOCKED")
        throw conflict("This audit's indexing check is already in progress");
      throw error;
    });
  try {
    const payload = await collect(context);
    const receipt = payload.receipt;
    return await serializableTransaction(async (tx) => {
      const current = await requireSeoTaskIndexingContext(
        auth,
        taskId,
        expected,
        tx,
        auditPageUrlHint,
      );
      assertSameSeoTaskIndexingContext(context, current);
      const held = await tx.lock.updateMany({
        where: {
          key,
          isLocked: true,
          lockedBy: lock.ownerToken,
          lockedAt: { gte: new Date(Date.now() - getEnv().LOCK_TIMEOUT) },
        },
        data: { lockedAt: new Date() },
      });
      if (!held.count)
        throw conflict("The indexing collection lease expired. Please retry");
      const sourceKey = receiptKey(context);
      const stored = await withRetainedAssessments(payload, context, tx);
      await tx.projectSeoObservation.upsert({
        where: seoOwnerUnique(context.actor, "sourceKey", { sourceKey }),
        create: {
          ...seoOwnerData(context.actor),
          sourceKey,
          kind: "index_inspection",
          source: "search_console",
          sourceTaskId: taskId,
          ownerId: context.actor.userId,
          visibility: "PRIVATE",
          pageIds: context.analysis.pageIds,
          scopeVersion: context.analysis.scopeVersion,
          artifactHash: receipt.receiptHash,
          payload: stored,
          observedAt: new Date(receipt.checkedAt),
        },
        update: {
          payload: stored,
          artifactHash: receipt.receiptHash,
          observedAt: new Date(receipt.checkedAt),
        },
      });
      const assessment = await tx.projectSeoObservation.findUnique({
        where: seoOwnerUnique(context.actor, "sourceKey", {
          sourceKey: `task-index-triage:${taskId}:${receipt.receiptHash}`,
        }),
      });
      const saved = hasSavedSeoIndexingAssessment(
        assessment,
        receipt,
        context.actor.userId,
        context.auditPageUrl,
      );
      return {
        receipt: saved ? { ...receipt, assessmentSaved: true } : receipt,
        retryable: shouldRetryInspection(payload),
      };
    }, "The audit changed before its indexing evidence could be saved. Please retry.");
  } finally {
    await syncLockService.releaseLock(key, lock.ownerToken);
  }
}

/** A result cannot select another receipt, owner, page scope, or connection revision. */
export async function recordSeoTaskIndexingResult(
  auth: AuthenticationContext,
  taskId: string,
  input: SeoTaskIndexingResultRequest,
) {
  return serializableTransaction(async (tx) => {
    const context = await requireSeoTaskIndexingContext(
      auth,
      taskId,
      input.expectedContext,
      tx,
      input.auditPageUrl,
    );
    const saved = await tx.projectSeoObservation.findUnique({
      where: seoOwnerUnique(context.actor, "sourceKey", {
        sourceKey: receiptKey(context),
      }),
    });
    const parsed = storedReceiptSchema.safeParse(saved?.payload);
    if (
      !saved ||
      saved.ownerId !== context.actor.userId ||
      saved.visibility !== "PRIVATE" ||
      saved.kind !== "index_inspection" ||
      saved.source !== "search_console" ||
      saved.sourceTaskId !== taskId ||
      !parsed.success ||
      parsed.data.contextFingerprint !== context.contextFingerprint ||
      (parsed.data.receipt.auditPageUrl ?? context.pageUrls[0]) !==
        context.auditPageUrl ||
      parsed.data.receipt.receiptHash !== input.receiptHash ||
      saved.artifactHash !== input.receiptHash
    )
      throw conflict("The indexing receipt is no longer current");
    const receipt = parsed.data.receipt;
    if (!currentReceipt(parsed.data))
      throw conflict(
        "The indexing receipt expired. Read it again before assessment",
      );
    if (
      new Set(input.assessments.map((page) => page.pageUrl)).size !==
        context.inspectionPageUrls.length ||
      input.assessments.length !== context.inspectionPageUrls.length ||
      input.assessments.some(
        (page) => !context.inspectionPageUrls.includes(page.pageUrl),
      )
    )
      throw unprocessableEntity(
        "Assess every approved indexing target exactly once",
      );
    if (
      input.assessments.some((assessment) => {
        const page = receipt.pages.find(
          (entry) => entry.pageUrl === assessment.pageUrl,
        );
        return (
          (!page || page.verdict === "VERDICT_UNSPECIFIED") &&
          assessment.status !== "unavailable"
        );
      })
    )
      throw unprocessableEntity(
        "An unanswered Google inspection must remain unavailable",
      );
    const result = seoTaskIndexingResultSchema.parse({
      version: 1,
      taskId,
      receiptHash: input.receiptHash,
      checkedAt: receipt.checkedAt,
      auditPageUrl: context.auditPageUrl,
      assessments: input.assessments.map(
        ({ publicEvidenceAvailable, ...page }) => {
          const checkedAt = parsed.data.reusedCheckedAt?.[page.pageUrl];
          const inspected = receipt.pages.find(
            (entry) => entry.pageUrl === page.pageUrl,
          );
          if (
            page.status === "unavailable" &&
            inspected &&
            googleReturnedUnknown(parsed.data, inspected)
          )
            return { ...page, checkedAt, googleReturnedUnknown: true };
          if (!checkedAt) return page;
          const retained = parsed.data.retainedAssessments?.find(
            (assessment) => assessment.pageUrl === page.pageUrl,
          );
          if (!retained) return { ...page, checkedAt };
          // A legacy review does not say whether its public read succeeded. Keep earlier conclusive evidence only.
          const keepPrevious =
            publicEvidenceAvailable === undefined
              ? retained.status !== "review" &&
                (page.status === "review" || page.status === "unavailable")
              : !publicEvidenceAvailable;
          return { ...(keepPrevious ? retained : page), checkedAt };
        },
      ),
    });
    const artifactHash = sha256(JSON.stringify(result));
    const sourceKey = `task-index-triage:${taskId}:${input.receiptHash}`;
    const existing = await tx.projectSeoObservation.findUnique({
      where: seoOwnerUnique(context.actor, "sourceKey", { sourceKey }),
    });
    if (existing) {
      if (
        hasSavedSeoIndexingAssessment(
          existing,
          receipt,
          context.actor.userId,
          context.auditPageUrl,
        )
      ) {
        if (existing.artifactHash === artifactHash) return result;
        // A replay of a pre-provenance result keeps the exact immutable payload first accepted.
        if (result.assessments.some((page) => page.googleReturnedUnknown)) {
          const legacy = {
            ...result,
            assessments: result.assessments.map(
              ({ googleReturnedUnknown: _provenance, ...page }) => page,
            ),
          };
          if (existing.artifactHash === sha256(JSON.stringify(legacy)))
            return legacy;
        }
      }
      throw conflict(
        "The same indexing receipt already has a different assessment",
      );
    }
    await tx.projectSeoObservation.create({
      data: {
        ...seoOwnerData(context.actor),
        sourceKey,
        kind: "index_triage",
        source: "seo_worker",
        sourceTaskId: taskId,
        ownerId: context.actor.userId,
        visibility: "PRIVATE",
        pageIds: context.analysis.pageIds,
        scopeVersion: context.analysis.scopeVersion,
        artifactHash,
        payload: result,
        observedAt: new Date(result.checkedAt),
      },
    });
    return result;
  }, "The audit changed before its indexing assessment could be saved. Please retry.");
}
