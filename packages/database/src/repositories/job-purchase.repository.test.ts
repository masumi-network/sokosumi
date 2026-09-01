import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { jobPurchaseRepository } from "./job-purchase.repository.js";

function createTx(update = vi.fn()) {
  return {
    tx: { jobPurchase: { update } } as unknown as Prisma.TransactionClient,
    update,
  };
}

describe("jobPurchaseRepository.updateJobPurchaseByJobId", () => {
  it("writes the payment node's purchase id so a stale externalId repairs", () => {
    const { tx, update } = createTx();

    jobPurchaseRepository.updateJobPurchaseByJobId(
      "job_1",
      { externalId: "purchase_new" },
      tx,
    );

    // The purchase diff joins on externalId. When the node replaces a purchase
    // row, the job is found by its blockchain identifier instead and this
    // write is what stops the next run from missing it again.
    expect(update).toHaveBeenCalledWith({
      where: { jobId: "job_1" },
      data: { externalId: "purchase_new" },
    });
  });

  it("omits fields that were not provided", () => {
    const { tx, update } = createTx();

    jobPurchaseRepository.updateJobPurchaseByJobId(
      "job_1",
      { resultHash: "hash" },
      tx,
    );

    expect(update).toHaveBeenCalledWith({
      where: { jobId: "job_1" },
      data: { resultHash: "hash" },
    });
  });
});
