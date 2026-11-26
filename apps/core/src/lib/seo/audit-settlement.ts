import type { Prisma, Task, TaskStatus } from "@sokosumi/database";
import { seoMaxCredits } from "@sokosumi/utils";
import { z } from "zod";
import { conflict, unprocessableEntity } from "@/helpers/error";
import {
  seoCostPlusPriceSchema,
  seoFullAuditCostDetailSchema,
  seoFullAuditCostSchema,
} from "@/schemas/seo-audit-price.schema";
import { storedSeoAuditSearchConsoleSchema } from "@/schemas/seo-task-indexing.schema";

const MICRO_USD_PER_USD = 1_000_000n;
const CREDITS_PER_USD = 100n;
const PERCENT = 100n;

type Receipt = z.infer<typeof seoFullAuditCostSchema>;
type Price = z.infer<typeof seoCostPlusPriceSchema>;

/** Round once after adding all receipt categories and applying the markup. */
export function fullAuditCharge(cost: Receipt, terms: Price): number {
  const total =
    BigInt(cost.gatewayMicroUsd) +
    BigInt(cost.directModelMicroUsd) +
    BigInt(cost.dataForSeoMicroUsd) +
    BigInt(cost.otherApiMicroUsd);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw unprocessableEntity(
      "The audit cost exceeds the supported receipt range",
    );
  const denominator = MICRO_USD_PER_USD * PERCENT;
  const numerator =
    total * CREDITS_PER_USD * (PERCENT + BigInt(terms.markupPercent));
  const credits = Math.max(
    terms.minimumCredits,
    Number((numerator + denominator - 1n) / denominator),
  );
  return terms.maxCredits === undefined
    ? credits
    : Math.min(terms.maxCredits, credits);
}

type BillingTask = Pick<
  Task,
  | "id"
  | "ownerId"
  | "workspaceId"
  | "organizationId"
  | "projectId"
  | "assigneeId"
>;

export function fullAuditBillingContext(task: BillingTask) {
  return {
    ownerId: task.ownerId,
    workspaceId: task.workspaceId,
    organizationId: task.organizationId,
    projectId: task.projectId,
    coworkerId: task.assigneeId,
  };
}

interface AuditPayment {
  status?: TaskStatus;
  credits?: number | null;
  masumiPayment?: unknown;
  fullAuditCost?: Receipt;
  fullAuditCostDetail?: unknown;
}

/** A focused check frozen with zero provider calls is free: Core approved no spend for it. */
function hasNoProviderBudget(packet: object | null): boolean {
  const budget = packet && "budget" in packet ? packet.budget : null;
  return (
    typeof budget === "object" &&
    budget !== null &&
    "maxProviderCalls" in budget &&
    typeof budget.maxProviderCalls === "number" &&
    seoMaxCredits({
      kind: "focused",
      providerCalls: budget.maxProviderCalls,
    }) === 0
  );
}

/** Validate the worker's event against the original approval before any ledger mutation. */
export async function prepareAuditSettlement(
  tx: Prisma.TransactionClient,
  task: BillingTask,
  body: AuditPayment,
  boundWorker: boolean,
  onApprovedCompletion?: () => void,
) {
  if (
    !body.fullAuditCost &&
    body.status !== "COMPLETED" &&
    !body.credits &&
    !body.masumiPayment
  )
    return;
  const analysis = await tx.projectSeoAnalysis.findUnique({
    where: { taskId: task.id },
    select: { id: true, kind: true, request: true },
  });
  const request = analysis?.request;
  if (
    body.status === "COMPLETED" &&
    analysis?.kind === "audit_full" &&
    storedSeoAuditSearchConsoleSchema.safeParse(request).data
      ?.searchConsoleAccess
  )
    onApprovedCompletion?.();
  const packet =
    request && typeof request === "object" && !Array.isArray(request)
      ? request
      : null;
  const price = packet?.price;
  if (
    analysis &&
    analysis.kind !== "audit_full" &&
    (body.credits || body.masumiPayment) &&
    hasNoProviderBudget(packet)
  )
    throw unprocessableEntity("A check with no provider budget cannot charge");
  if (
    analysis?.kind !== "audit_full" ||
    !price ||
    typeof price !== "object" ||
    Array.isArray(price) ||
    price.kind !== "cost_plus"
  ) {
    if (body.fullAuditCost)
      throw unprocessableEntity("This Task has no approved full-audit price");
    return;
  }
  if (packet?.fullAuditCost !== undefined) {
    if (
      body.status === "COMPLETED" &&
      !body.credits &&
      !body.masumiPayment &&
      !body.fullAuditCost
    )
      return;
    throw conflict("This full audit has already been charged");
  }
  const approved = packet?.fullAuditBillingContext;
  if (
    !approved ||
    typeof approved !== "object" ||
    Array.isArray(approved) ||
    Object.entries(fullAuditBillingContext(task)).some(
      ([key, value]) => approved[key] !== value,
    )
  )
    throw conflict(
      "The Task no longer has its approved billing owner, workspace, project or coworker",
    );
  const terms = seoCostPlusPriceSchema.safeParse(price);
  if (
    !terms.success ||
    !boundWorker ||
    body.status !== "COMPLETED" ||
    body.masumiPayment ||
    !body.fullAuditCost
  )
    throw unprocessableEntity(
      "The assigned worker must settle a completed full audit with its cost receipts",
    );
  if (body.credits !== fullAuditCharge(body.fullAuditCost, terms.data))
    throw unprocessableEntity(
      "The full-audit charge does not match the cost receipts and approved terms",
    );
  const receipt = body.fullAuditCost;
  if (packet.pendingFullAuditCost !== undefined) {
    const previous = seoFullAuditCostSchema.safeParse(
      packet.pendingFullAuditCost,
    );
    if (
      !previous.success ||
      JSON.stringify(previous.data) !== JSON.stringify(receipt)
    )
      throw conflict(
        "The cost receipt changed after the first settlement attempt",
      );
  }
  return (status: TaskStatus | null) => {
    if (status !== "COMPLETED" && status !== "OUT_OF_CREDITS") return;
    const { pendingFullAuditCost: _pending, ...original } = packet;
    const field =
      status === "COMPLETED" ? "fullAuditCost" : "pendingFullAuditCost";
    // Display only: the first valid detail wins, and an invalid one is dropped.
    const detail =
      original.fullAuditCostDetail === undefined
        ? seoFullAuditCostDetailSchema.safeParse(body.fullAuditCostDetail).data
        : undefined;
    return tx.projectSeoAnalysis.update({
      where: { id: analysis.id },
      data: {
        request: {
          ...original,
          [field]: receipt,
          ...(detail && { fullAuditCostDetail: detail }),
        } as Prisma.InputJsonObject,
      },
    });
  };
}

/** A full audit already accounts for all attributable vendor costs at completion. */
export async function requireSeparateAuditPurchaseAllowed(
  tx: Prisma.TransactionClient,
  taskId: string,
) {
  const audit = await tx.projectSeoAnalysis.findFirst({
    where: {
      taskId,
      kind: "audit_full",
      request: { path: ["price", "kind"], equals: "cost_plus" },
    },
    select: { id: true },
  });
  if (audit)
    throw unprocessableEntity(
      "A full audit charges once at completion and cannot make a separate Task purchase",
    );
}
