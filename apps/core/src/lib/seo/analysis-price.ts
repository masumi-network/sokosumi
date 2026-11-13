import type { Prisma } from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import {
  CORE_API_ERROR_KINDS,
  convertCentsToCredits,
  convertCreditsToCents,
  seoMaxCredits,
} from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error";
import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";

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
