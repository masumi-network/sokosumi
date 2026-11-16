import type { Prisma, Task } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { canonicalJsonKey } from "@sokosumi/masumi/schemas";
import {
  CORE_API_ERROR_KINDS,
  convertCentsToCredits,
  convertCreditsToCents,
  seoMaxCredits,
} from "@sokosumi/utils";
import { z } from "zod";

import { unprocessableEntity } from "@/helpers/error";
import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";
import { getSeoAnalysisExecution } from "./analysis-executor-config";

/** The most this check can charge: what the dialog shows as "up to". */
export function seoAnalysisMaxCredits(
  input: RequestSeoAnalysis,
  pageCount: number,
): number {
  return input.kind === "audit_full"
    ? seoMaxCredits({
        kind: "audit_full",
        pages: pageCount,
        usd: input.fullAuditLimits?.usd,
      })
    : seoMaxCredits({
        kind: "focused",
        providerCalls: input.maxProviderCalls,
      });
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
      `Not enough credits. This check costs up to ${maxCredits} credits and the balance is ${Math.floor(convertCentsToCredits(balance))}.`,
      { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
    );
}

// The ceiling comes from the frozen Core packet, not the worker's estimate.
const storedSeoPriceSchema = z.object({
  pageUrls: z.array(z.string()).min(1),
  budget: z
    .object({ maxProviderCalls: z.number().int().nonnegative() })
    .optional(),
  limits: z.object({ usd: z.number().nonnegative() }).optional(),
});

/** A successful RUNNING response authorizes provider work, so fail before any event is committed. */
export async function requireSeoTaskStartBalance(
  tx: Prisma.TransactionClient,
  task: Pick<
    Task,
    | "id"
    | "ownerId"
    | "organizationId"
    | "projectId"
    | "assigneeId"
    | "description"
  >,
): Promise<void> {
  const analysis = await tx.projectSeoAnalysis.findUnique({
    where: { taskId: task.id },
    select: { kind: true, request: true },
  });
  if (!analysis) {
    const { executor } = getSeoAnalysisExecution();
    if (
      executor &&
      "mode" in executor &&
      executor.coworkerId === task.assigneeId
    )
      throw unprocessableEntity(
        "Start this check from an SEO audit so its scope and price can be approved",
      );
    return;
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
  const approvedPacket = canonicalJsonKey(analysis.request);
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
  const ceiling =
    analysis.kind === "audit_full"
      ? seoMaxCredits({
          kind: "audit_full",
          pages: packet.pageUrls.length,
          usd: packet.limits?.usd,
        })
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
