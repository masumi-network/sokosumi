import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { getWebAppBaseUrl } from "@/config/env";
import {
  conflict,
  serviceUnavailable,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import { serializableTransaction } from "@/lib/db/transaction";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import { withinSearchConsoleRetention } from "@/lib/seo/native-statistics";
import {
  GSC_TASK_OPERATIONS,
  GSC_TASK_READ_BUDGET,
  gscTaskReplyBody,
  gscTaskToolArguments,
} from "@/lib/seo/search-console-task-read";
import type { AuthenticationContext } from "@/middleware/auth";
import type {
  SeoTaskSearchConsoleRead,
  SeoTaskSearchConsoleReply,
  SeoTaskSearchConsoleStatus,
} from "@/schemas/seo-task-search-console.schema";
import { readNativeSeoTool } from "./project-seo-statistics.service";
import { seoOwnerData, seoOwnerUnique, sha256 } from "./project-seo-store";
import { recordSeoConnectionFailure } from "./seo-connections.service";
import {
  requireConnectedSearchConsole,
  requireSeoTaskSearchConsoleContext,
  type SeoTaskSearchConsoleContext,
  type SeoTaskSearchConsoleExpected,
} from "./seo-task-search-console-context";

/** The whole provider step, including tool discovery. */
const GSC_TASK_READ_TIMEOUT_MS = 45_000;
const BUDGET_KIND = "task_gsc_read_budget";
const budgetSchema = z.record(z.string(), z.number().int().nonnegative());

/** The web Task page the worker shows the owner. The worker validates exactly this form. */
function authenticationUrl(taskId: string) {
  return `${getWebAppBaseUrl().replace(/\/+$/, "")}/tasks/${encodeURIComponent(taskId)}?googleConnection=connect`;
}

export async function getSeoTaskSearchConsoleStatus(
  auth: AuthenticationContext,
  taskId: string,
): Promise<SeoTaskSearchConsoleStatus> {
  const context = await serializableTransaction(
    (tx) => requireSeoTaskSearchConsoleContext(auth, taskId, null, tx),
    "The audit or Google connection changed. Please retry.",
  );
  return {
    provider: "search-console",
    status: context.status,
    ...(context.reason && { reason: context.reason }),
    authenticationUrl: authenticationUrl(taskId),
    expiresAt: context.expiresAt,
  };
}

/** The read must stay inside the audit's frozen property. */
function requireApprovedTarget(
  read: SeoTaskSearchConsoleRead,
  propertyId: string,
) {
  const property = () =>
    conflict("Read only the audit's approved Search Console property.", {
      kind: CORE_API_ERROR_KINDS.SEO_GSC_PROPERTY,
    });
  if (read.operation === "sites.list") return;
  if (read.siteUrl !== propertyId) throw property();
  if (
    read.operation === "urlInspection.inspect" &&
    !gscPropertyCovers(propertyId, [read.inspectionUrl])
  )
    throw property();
}

/** Durable and inside the Task lock, so parallel reads cannot pass the same budget. */
async function spendReadBudget(
  tx: Prisma.TransactionClient,
  context: SeoTaskSearchConsoleContext,
  operation: SeoTaskSearchConsoleRead["operation"],
) {
  const sourceKey = `task-gsc-reads:${context.taskId}`;
  const where = seoOwnerUnique(context.actor, "sourceKey", { sourceKey });
  const row = await tx.projectSeoObservation.findUnique({ where });
  if (row && (row.kind !== BUDGET_KIND || row.ownerId !== context.actor.userId))
    throw conflict("The Search Console read budget is unavailable");
  const used = budgetSchema.safeParse(row?.payload).data ?? {};
  const spent = used[operation] ?? 0;
  if (spent >= GSC_TASK_READ_BUDGET[operation])
    throw tooManyRequests(
      "This audit Task used its Search Console read budget for this operation",
    );
  const payload = { ...used, [operation]: spent + 1 };
  const update = {
    payload,
    artifactHash: sha256(JSON.stringify(payload)),
    observedAt: new Date(),
  };
  // No page ids and no source Task: audit readers and page-scope checks never see this row.
  await tx.projectSeoObservation.upsert({
    where,
    create: {
      ...seoOwnerData(context.actor),
      sourceKey,
      kind: BUDGET_KIND,
      source: "search_console",
      ownerId: context.actor.userId,
      visibility: "PRIVATE",
      pageIds: [],
      ...update,
    },
    update,
  });
}

async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Search Console read timed out")),
          GSC_TASK_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function recheck(
  auth: AuthenticationContext,
  taskId: string,
  expected: SeoTaskSearchConsoleExpected,
  before: SeoTaskSearchConsoleContext,
) {
  return serializableTransaction(async (tx) => {
    const current = await requireSeoTaskSearchConsoleContext(
      auth,
      taskId,
      expected,
      tx,
    );
    if (current.task.status !== "RUNNING")
      throw conflict("Search Console reads require a running audit Task");
    requireConnectedSearchConsole(current);
    if (current.fingerprint !== before.fingerprint)
      throw conflict("The audit or Google connection changed during the read", {
        kind: "task_context_changed",
      });
  }, "The audit or Google connection changed during the read. Please retry.");
}

/**
 * One Task-scoped Google read for the SEO worker. Core keeps the account and
 * every credential. The provider call runs outside any database transaction,
 * and the reply leaves Core only after the Task and connection are unchanged.
 */
export async function readSeoTaskSearchConsole(
  auth: AuthenticationContext,
  taskId: string,
  read: SeoTaskSearchConsoleRead,
): Promise<SeoTaskSearchConsoleReply> {
  const expected = {
    ownerId: read.expectedOwnerId,
    organizationId: read.expectedOrganizationId,
  };
  const before = await serializableTransaction(async (tx) => {
    const context = await requireSeoTaskSearchConsoleContext(
      auth,
      taskId,
      expected,
      tx,
    );
    if (context.task.status !== "RUNNING")
      throw conflict("Search Console reads require a running audit Task");
    const { access } = requireConnectedSearchConsole(context);
    requireApprovedTarget(read, access.propertyId);
    if (
      read.operation === "searchAnalytics.query" &&
      !withinSearchConsoleRetention(read.query.startDate)
    )
      throw unprocessableEntity(
        "The period starts outside Search Console retention",
      );
    await spendReadBudget(tx, context, read.operation);
    return context;
  }, "The audit or Google connection changed. Please retry.");
  const { integration, access } = requireConnectedSearchConsole(before);
  let reply: SeoTaskSearchConsoleReply;
  try {
    const data = await withDeadline(
      readNativeSeoTool(
        integration,
        GSC_TASK_OPERATIONS[read.operation].tool,
        gscTaskToolArguments(read, access.propertyId),
      ),
    );
    reply = gscTaskReplyBody(read, access.propertyId, data);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 502) throw error;
    // Upstream errors can hold account data. Only safe fields reach the log.
    recordCoreWarning(
      { operation: "seo_task_search_console_read" },
      {
        message: "A Task-scoped Search Console read failed.",
        why: "The Composio tool call failed or its answer was not readable.",
      },
      { stage: read.operation, failure: messageSafeErrorFields(error) },
    );
    await recordSeoConnectionFailure(
      before.actor,
      "search_console",
      integration,
    );
    // A revoked account now reads as a reconnect; anything else is retryable.
    await recheck(auth, taskId, expected, before);
    throw serviceUnavailable(
      "Search Console could not be read. Retry this read.",
    );
  }
  await recheck(auth, taskId, expected, before);
  return reply;
}
