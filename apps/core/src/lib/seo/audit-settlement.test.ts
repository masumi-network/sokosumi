import type { Prisma } from "@sokosumi/database";
import { seoCrawlNextPrice, seoFullAuditPrice } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  fullAuditBillingContext,
  fullAuditCharge,
  prepareAuditSettlement,
  requireSeparateAuditPurchaseAllowed,
} from "./audit-settlement";

const task = {
  id: "task-1",
  ownerId: "user-1",
  workspaceId: "workspace-1",
  organizationId: null,
  projectId: "project-1",
  assigneeId: "coworker-1",
};
const USD = 1_000_000;
const receipt = (dataForSeoMicroUsd: number) => ({
  version: 1 as const,
  gatewayMicroUsd: 0,
  directModelMicroUsd: 0,
  dataForSeoMicroUsd,
  otherApiMicroUsd: 0,
});

/** The one read settlement makes: the Task's analysis row. */
function txWith(kind: string, price: unknown) {
  const row = {
    id: "analysis-1",
    kind,
    request: { price, fullAuditBillingContext: fullAuditBillingContext(task) },
  };
  return {
    projectSeoAnalysis: { findUnique: async () => row },
  } as unknown as Prisma.TransactionClient;
}

const settle = (kind: string, price: unknown, credits: number, cost = 0) =>
  prepareAuditSettlement(
    txWith(kind, price),
    task,
    { status: "COMPLETED", credits, fullAuditCost: receipt(cost) },
    true,
  );

describe("crawl continuation settlement", () => {
  it("charges at least 100 credits and has no upper limit", () => {
    expect(fullAuditCharge(receipt(0), seoCrawlNextPrice())).toBe(100);
    // USD 20 of costs plus 50%: 3,000 credits, above the full audit's 750 cap of old approvals.
    expect(fullAuditCharge(receipt(20 * USD), seoCrawlNextPrice())).toBe(3000);
  });

  it("settles a crawl continuation on its own terms only", async () => {
    await expect(
      settle("crawl_next", seoCrawlNextPrice(), 100),
    ).resolves.toBeTypeOf("function");
    await expect(
      settle("crawl_next", seoFullAuditPrice(), 750),
    ).rejects.toThrow("must settle");
    await expect(
      settle("audit_full", seoCrawlNextPrice(), 100),
    ).rejects.toThrow("must settle");
  });

  it("refuses a charge that does not match the receipts", async () => {
    await expect(
      settle("crawl_next", seoCrawlNextPrice(), 100, 2 * USD),
    ).rejects.toThrow("does not match");
  });

  it("refuses a separate Task purchase", async () => {
    await expect(
      requireSeparateAuditPurchaseAllowed(
        txWith("crawl_next", seoCrawlNextPrice()),
        task.id,
      ),
    ).rejects.toThrow("charges once at completion");
  });
});
