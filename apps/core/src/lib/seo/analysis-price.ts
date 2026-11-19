import type { Prisma, Task } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { canonicalJsonKey } from "@sokosumi/masumi/schemas";
import {
  CORE_API_ERROR_KINDS,
  convertCentsToCredits,
  convertCreditsToCents,
  SEO_DEFAULT_FULL_AUDIT_USD,
  SEO_FULL_AUDIT_CREDITS,
  SEO_PAGE_CEILING_CENTS,
  seoCreditsForCents,
  seoMaxCredits,
} from "@sokosumi/utils";
import { z } from "zod";

import { conflict, unprocessableEntity } from "@/helpers/error";
import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";
import { getSeoAnalysisExecution } from "./analysis-executor-config";
import { originalSeoAuditPacket } from "./related-page-selection";

/** The most this check can charge: what the dialog shows as "up to". */
export function seoAnalysisMaxCredits(
  input: RequestSeoAnalysis,
  pageCount: number,
): number {
  return input.kind === "audit_full"
    ? (input.fullAuditCredits ??
        seoCreditsForCents(
          pageCount <= 1
            ? SEO_PAGE_CEILING_CENTS
            : Math.round(
                (input.fullAuditLimits?.usd ?? SEO_DEFAULT_FULL_AUDIT_USD) *
                  CENTS_PER_USD,
              ),
        ))
    : seoMaxCredits({
        kind: "focused",
        providerCalls: input.maxProviderCalls,
      });
}

/** A stale client must reload its quote before it creates paid work. Legacy scheduled releases bypass this new-approval gate. */
export function requireSeoFullAuditPriceApproval(
  input: RequestSeoAnalysis,
): void {
  if (
    input.kind === "audit_full" &&
    input.fullAuditCredits !== SEO_FULL_AUDIT_CREDITS
  )
    throw conflict(
      "The full-audit price changed. Reload and approve 750 credits before starting.",
    );
}

/**
 * Refuses a check whose ceiling the payer cannot cover. The check service
 * charges the Task's Owner at completion, Project credits first (ADR 0067), so
 * the balance is read the same way. A check reserves nothing: two checks
 * started together can still end with one paused for credits.
 */
export async function requireSeoAnalysisBalance(
  tx: Prisma.TransactionClient,
  payer: {
    userId: string;
    organizationId: string | null;
    projectId: string | null;
  },
  maxCredits: number,
): Promise<void> {
  if (maxCredits <= 0) return;
  const balance = await creditBucketRepository.getBalance(
    payer.userId,
    payer.organizationId,
    tx,
    { projectId: payer.projectId },
  );
  if (balance < convertCreditsToCents(maxCredits))
    throw unprocessableEntity(
      `Not enough credits. This check requires ${maxCredits} credits and the balance is ${Math.floor(convertCentsToCredits(balance))}.`,
      { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    );
}

// The ceiling comes from the frozen Core packet, not the worker's estimate.
const CENTS_PER_USD = 100;
const storedSeoPriceSchema = z.object({
  pageUrls: z.array(z.string()).min(1),
  price: z
    .object({
      kind: z.literal("fixed"),
      credits: z.literal(SEO_FULL_AUDIT_CREDITS),
    })
    .strict()
    .optional(),
  budget: z
    .object({ maxProviderCalls: z.number().int().nonnegative() })
    .optional(),
  limits: z.object({ usd: z.number().nonnegative() }).optional(),
});

export function readSeoTaskStartAnalysis(
  tx: Prisma.TransactionClient,
  taskId: string,
) {
  return tx.projectSeoAnalysis.findUnique({
    where: { taskId },
    select: {
      kind: true,
      request: true,
      requestedBy: true,
      projectId: true,
      auditId: true,
      pageIds: true,
      requestHash: true,
    },
  });
}

/** A successful RUNNING response authorizes provider work, so fail before any event is committed. */
export async function requireSeoTaskStartBalance(
  tx: Prisma.TransactionClient,
  task: Pick<
    Task,
    | "id"
    | "workspaceId"
    | "ownerId"
    | "organizationId"
    | "projectId"
    | "assigneeId"
    | "description"
  >,
  found?: Awaited<ReturnType<typeof readSeoTaskStartAnalysis>>,
): Promise<void> {
  const analysis =
    found === undefined ? await readSeoTaskStartAnalysis(tx, task.id) : found;
  if (!analysis) {
    const { executor } = getSeoAnalysisExecution();
    if (!executor || executor.coworkerId !== task.assigneeId) return;
    if (!("mode" in executor)) {
      if (
        !executor.canUsePaidSearchData ||
        executor.workspaceId !== task.workspaceId ||
        executor.ownerId !== task.ownerId ||
        executor.organizationId !== task.organizationId
      )
        return;
      // The worker reads a seo_job line as a focused check or rejects it. Plain Tasks can start full audits.
      if (
        task.description
          ?.split(/\r?\n/)
          .some((line) => /^\s*seo_job\s*:/i.test(line))
      )
        return;
    }
    throw unprocessableEntity(
      "Start this check from an SEO audit so its scope and price can be approved",
    );
  }
  const marker = analysis.kind === "audit_full" ? "seo_audit:" : "seo_job:";
  let currentPacket: unknown;
  try {
    if (!task.description?.startsWith(marker))
      throw new Error("Missing SEO packet");
    currentPacket = JSON.parse(task.description.slice(marker.length));
  } catch {
    throw unprocessableEntity(
      "The SEO Task no longer contains its approved request",
    );
  }
  const approvedPacket = canonicalJsonKey(
    originalSeoAuditPacket(analysis.request),
  );
  if (!approvedPacket || canonicalJsonKey(currentPacket) !== approvedPacket)
    throw unprocessableEntity(
      "The SEO Task request changed. Start a new check from the audit",
    );
  const parsed = storedSeoPriceSchema.safeParse(analysis.request);
  if (
    !parsed.success ||
    (analysis.kind !== "audit_full" && !parsed.data.budget) ||
    !task.ownerId
  )
    throw unprocessableEntity(
      "The SEO check has no approved scope, price or billing owner",
    );
  const packet = parsed.data;
  if (analysis.kind !== "audit_full" && packet.price)
    throw unprocessableEntity("A focused check cannot use a full-audit price");
  const ceiling =
    analysis.kind === "audit_full"
      ? (packet.price?.credits ??
        seoCreditsForCents(
          packet.pageUrls.length <= 1
            ? SEO_PAGE_CEILING_CENTS
            : Math.round(
                (packet.limits?.usd ?? SEO_DEFAULT_FULL_AUDIT_USD) *
                  CENTS_PER_USD,
              ),
        ))
      : seoMaxCredits({
          kind: "focused",
          providerCalls: packet.budget!.maxProviderCalls,
        });
  await requireSeoAnalysisBalance(
    tx,
    {
      userId: task.ownerId,
      organizationId: task.organizationId,
      projectId: task.projectId,
    },
    ceiling,
  );
}
