import { z } from "@hono/zod-openapi";
import type { ProjectSeoObservation } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import { conflict, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
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
  seoTaskIndexingReceiptSchema,
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
import { syncLockService } from "./sync-lock.service";

export const SEO_INDEXING_FRESH_MS = 24 * 60 * 60 * 1000;
const SEO_INDEXING_RETRY_MS = 60 * 60 * 1000;
const persistedReceiptSchema = seoTaskIndexingReceiptSchema.omit({
  assessmentSaved: true,
});
const storedReceiptSchema = z.strictObject({
  contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  propertyId: z.string().max(500).nullable(),
  receipt: persistedReceiptSchema,
});
type StoredReceipt = z.infer<typeof storedReceiptSchema>;

const receiptKey = (context: SeoTaskIndexingContext) =>
  `task-indexing:${context.taskId}:${context.contextFingerprint}`;

async function savedReceipt(context: SeoTaskIndexingContext) {
  const saved = await prisma.projectSeoObservation.findUnique({
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
  const age = Date.now() - new Date(receipt.checkedAt).getTime();
  const partial =
    receipt.status !== "available" ||
    receipt.pages.some((page) => page.verdict === "VERDICT_UNSPECIFIED");
  return age >= 0 &&
    age < (partial ? SEO_INDEXING_RETRY_MS : SEO_INDEXING_FRESH_MS)
    ? parsed.data
    : null;
}

function makeReceipt(
  context: SeoTaskIndexingContext,
  data: Omit<SeoTaskIndexingReceipt, "receiptHash" | "assessmentSaved">,
  propertyId: string | null,
): StoredReceipt {
  return {
    contextFingerprint: context.contextFingerprint,
    propertyId,
    receipt: persistedReceiptSchema.parse({
      ...data,
      receiptHash: sha256(
        JSON.stringify({
          context: context.contextFingerprint,
          propertyId,
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
  const saved = await savedReceipt(context);
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
    const results = await Promise.allSettled(
      context.inspectionPageUrls.map(async (pageUrl) =>
        !gscPropertyCovers(property, [pageUrl])
          ? unavailableGscTaskInspection(pageUrl)
          : normalizeGscTaskInspection(
              pageUrl,
              unwrapNativeStatistics(
                await read(
                  inspectionTool,
                  gscInspectionArguments(property, pageUrl),
                ),
                ["inspectionResult"],
              ),
            ),
      ),
    );
    const pages = results.map((result, index) =>
      result.status === "fulfilled" ? result.value : base.pages[index]!,
    );
    return makeReceipt(
      context,
      {
        ...base,
        status: pages.some((page) => page.verdict !== "VERDICT_UNSPECIFIED")
          ? "available"
          : "unavailable",
        pages,
      },
      property,
    );
  } catch {
    // Upstream failures can contain account data. No raw error crosses the Task boundary.
    return makeReceipt(context, { ...base, status: "unavailable" }, null);
  }
}

/** A lost result response can retry without repeating mutable public-page reads. */
export function hasSavedSeoIndexingAssessment(
  saved: Pick<
    ProjectSeoObservation,
    | "ownerId"
    | "visibility"
    | "kind"
    | "source"
    | "sourceTaskId"
    | "artifactHash"
    | "payload"
  > | null,
  receipt: SeoTaskIndexingReceipt,
  ownerId: string,
  auditPageUrl: string,
): boolean {
  if (
    !saved ||
    saved.ownerId !== ownerId ||
    saved.visibility !== "PRIVATE" ||
    saved.kind !== "index_triage" ||
    saved.source !== "seo_worker" ||
    saved.sourceTaskId !== receipt.taskId
  )
    return false;
  const parsed = seoTaskIndexingResultSchema.safeParse(saved.payload);
  if (!parsed.success) return false;
  const result = parsed.data;
  return (
    result.taskId === receipt.taskId &&
    result.receiptHash === receipt.receiptHash &&
    result.checkedAt === receipt.checkedAt &&
    (receipt.auditPageUrl === undefined ||
      receipt.auditPageUrl === auditPageUrl) &&
    (result.auditPageUrl === undefined ||
      result.auditPageUrl === auditPageUrl) &&
    saved.artifactHash === sha256(JSON.stringify(result)) &&
    result.assessments.length === receipt.pages.length &&
    new Set(result.assessments.map((page) => page.pageUrl)).size ===
      receipt.pages.length &&
    result.assessments.every((assessment) => {
      const page = receipt.pages.find(
        (entry) => entry.pageUrl === assessment.pageUrl,
      );
      return (
        page &&
        (page.verdict !== "VERDICT_UNSPECIFIED" ||
          assessment.status === "unavailable")
      );
    })
  );
}

/** Only the Task's fixed pages are read. All provider I/O is outside database transactions. */
export async function readSeoTaskIndexing(
  auth: AuthenticationContext,
  taskId: string,
  expected: TaskWorkerContext,
  auditPageUrlHint?: string,
): Promise<SeoTaskIndexingReceipt> {
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
          payload,
          observedAt: new Date(receipt.checkedAt),
        },
        update: {
          payload,
          artifactHash: receipt.receiptHash,
          observedAt: new Date(receipt.checkedAt),
        },
      });
      const assessment = await tx.projectSeoObservation.findUnique({
        where: seoOwnerUnique(context.actor, "sourceKey", {
          sourceKey: `task-index-triage:${taskId}:${receipt.receiptHash}`,
        }),
      });
      return hasSavedSeoIndexingAssessment(
        assessment,
        receipt,
        context.actor.userId,
        context.auditPageUrl,
      )
        ? { ...receipt, assessmentSaved: true as const }
        : receipt;
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
    const age = Date.now() - new Date(receipt.checkedAt).getTime();
    const partial =
      receipt.status !== "available" ||
      receipt.pages.some((page) => page.verdict === "VERDICT_UNSPECIFIED");
    if (
      age < 0 ||
      age >= (partial ? SEO_INDEXING_RETRY_MS : SEO_INDEXING_FRESH_MS)
    )
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
      assessments: input.assessments,
    });
    const artifactHash = sha256(JSON.stringify(result));
    const sourceKey = `task-index-triage:${taskId}:${input.receiptHash}`;
    const existing = await tx.projectSeoObservation.findUnique({
      where: seoOwnerUnique(context.actor, "sourceKey", { sourceKey }),
    });
    if (existing) {
      if (
        existing.ownerId !== context.actor.userId ||
        existing.visibility !== "PRIVATE" ||
        existing.artifactHash !== artifactHash
      )
        throw conflict(
          "The same indexing receipt already has a different assessment",
        );
      return result;
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
