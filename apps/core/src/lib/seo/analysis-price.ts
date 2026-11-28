import type { Prisma, Task } from "@sokosumi/database";
import { canonicalJsonKey } from "@sokosumi/masumi/schemas";
import {
  CORE_API_ERROR_KINDS,
  convertCentsToCredits,
  convertCreditsToCents,
  SEO_DEFAULT_FULL_AUDIT_USD,
  SEO_FULL_AUDIT_CREDITS,
  SEO_FULL_AUDIT_MARKUP_PERCENT,
  SEO_PAGE_CEILING_CENTS,
  type SeoTaskMarker,
  seoCreditsForCents,
  seoMaxCredits,
  seoTaskRequestPacket,
} from "@sokosumi/utils";
import { z } from "zod";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { getBalance } from "@/lib/credits/balance";
import { createNetworkScope } from "@/lib/db/network-scope";
import type { RequestSeoAnalysis } from "@/schemas/project-seo.schema";
import {
  seoCrawlNextPriceSchema,
  storedSeoFullAuditPriceSchema,
} from "@/schemas/seo-audit-price.schema";
import { getSeoAnalysisExecution } from "./analysis-executor-config";
import { originalSeoAuditPacket } from "./related-page-selection";

/** Balance required before dispatch. Uncapped full audits check only their minimum here. */
export function seoAnalysisAdmissionCredits(
  input: RequestSeoAnalysis,
  pageCount: number,
): number {
  return input.kind === "audit_full"
    ? (input.fullAuditPrice?.maxCredits ??
        input.fullAuditPrice?.minimumCredits ??
        input.fullAuditCredits ??
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

/** The cost-plus terms a new full audit sends, as JSON for error messages. */
const SEO_FULL_AUDIT_PRICE_TERMS = JSON.stringify({
  kind: "cost_plus",
  version: 1,
  minimumCredits: SEO_FULL_AUDIT_CREDITS,
  markupPercent: SEO_FULL_AUDIT_MARKUP_PERCENT,
})
  .replaceAll(":", ": ")
  .replaceAll(",", ", ");

/** A stale client must reload its quote before it creates paid work. Legacy scheduled releases bypass this new-approval gate. */
export function requireSeoFullAuditPriceApproval(
  input: RequestSeoAnalysis,
  subscriptionApproved = false,
): void {
  if (input.kind !== "audit_full") return;
  if (
    subscriptionApproved &&
    input.fullAuditCredits === SEO_FULL_AUDIT_CREDITS &&
    !input.fullAuditPrice
  )
    return;
  // Stale browsers sent a cap; agents read it as a spending limit (SOKD-483).
  if (input.fullAuditPrice?.maxCredits !== undefined)
    throw conflict(
      `Leave out fullAuditPrice.maxCredits: a full audit has no credit cap. Send fullAuditPrice as ${SEO_FULL_AUDIT_PRICE_TERMS}, after the person approves that price.`,
    );
  if (input.fullAuditPrice) return;
  // A client that still sends the old fixed credits needs to reload its quote.
  if (input.fullAuditCredits !== undefined)
    throw conflict(
      "The full-audit price changed. Review the new price before you start.",
    );
  throw conflict(
    `A full audit needs fullAuditPrice: send ${SEO_FULL_AUDIT_PRICE_TERMS}, after the person approves that price.`,
  );
}

/**
 * Refuses a check when the payer cannot cover its starting balance requirement. The check service
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
  const balance = await getBalance(
    createNetworkScope("mainnet"),
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
  price: storedSeoFullAuditPriceSchema.optional(),
  budget: z
    .object({ maxProviderCalls: z.number().int().nonnegative() })
    .optional(),
  limits: z.object({ usd: z.number().nonnegative() }).optional(),
});
/** A crawl continuation reads no page list: its ceiling is its minimum, as for an uncapped full audit. */
const storedCrawlNextPriceSchema = z.object({ price: seoCrawlNextPriceSchema });

/** The request line each analysis kind writes into its Task. */
const SEO_TASK_MARKER = {
  audit_full: "seo_audit",
  crawl_next: "seo_crawl_next",
} as const satisfies Record<string, SeoTaskMarker>;
const taskMarker = (kind: string): SeoTaskMarker =>
  kind in SEO_TASK_MARKER
    ? SEO_TASK_MARKER[kind as keyof typeof SEO_TASK_MARKER]
    : "seo_job";

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
  let currentPacket: unknown;
  try {
    currentPacket = seoTaskRequestPacket(
      task.description ?? "",
      taskMarker(analysis.kind),
    );
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
  if (analysis.kind === "crawl_next") {
    const terms = storedCrawlNextPriceSchema.safeParse(analysis.request);
    if (!terms.success || !task.ownerId)
      throw unprocessableEntity(
        "The SEO check has no approved scope, price or billing owner",
      );
    return requireSeoAnalysisBalance(
      tx,
      {
        userId: task.ownerId,
        organizationId: task.organizationId,
        projectId: task.projectId,
      },
      terms.data.price.minimumCredits,
    );
  }
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
      ? ((packet.price?.kind === "cost_plus"
          ? (packet.price.maxCredits ?? packet.price.minimumCredits)
          : packet.price?.credits) ??
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
