import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import {
  EnterpriseContractStatus,
  type Prisma as PrismaType,
} from "../generated/prisma/client.js";
import { deriveEnterpriseContractEndDate } from "./enterprise-contract.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";

const resolveActiveSubscriptionByReferenceIdMock = vi.fn();

vi.mock("../repositories/subscription.repository.js", () => ({
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

const ORG_ID = "org-billing-plan-test";
const CONTRACT_ID = "01900000-0000-7000-8000-000000000099";

function createTx(
  activeContract: {
    id: string;
    periodCount: number;
    seats: number;
    activatedAt: Date;
    status: EnterpriseContractStatus;
  } | null,
): PrismaType.TransactionClient {
  return {
    enterpriseContract: {
      findFirst: vi.fn().mockResolvedValue(activeContract),
    },
  } as unknown as PrismaType.TransactionClient;
}

describe("resolveOrganizationBillingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
  });

  it("returns enterprise_contract with isConsumable true within the commercial term", async () => {
    const activatedAt = new Date("2026-05-01T00:00:00.000Z");
    const now = new Date("2026-06-01T00:00:00.000Z");
    const tx = createTx({
      id: CONTRACT_ID,
      periodCount: 8,
      seats: 25,
      activatedAt,
      status: EnterpriseContractStatus.active,
    });

    const plan = await resolveOrganizationBillingPlan(ORG_ID, tx, now);

    assert.equal(plan.mode, "enterprise_contract");
    if (plan.mode !== "enterprise_contract") {
      return;
    }

    assert.equal(plan.plan, "enterprise");
    assert.equal(plan.isConsumable, true);
    assert.equal(plan.purchasedSeats, 25);
    assert.equal(plan.contractId, CONTRACT_ID);
    assert.equal(
      plan.endsAt.toISOString(),
      deriveEnterpriseContractEndDate(activatedAt, 8).toISOString(),
    );
    assert.equal(
      resolveActiveSubscriptionByReferenceIdMock.mock.calls.length,
      0,
    );
  });

  it("returns enterprise_contract with isConsumable false after the commercial term", async () => {
    const activatedAt = new Date("2026-01-01T00:00:00.000Z");
    const periodCount = 1;
    const endsAt = deriveEnterpriseContractEndDate(activatedAt, periodCount);
    const now = new Date(endsAt.getTime() + 1);
    const tx = createTx({
      id: CONTRACT_ID,
      periodCount,
      seats: 5,
      activatedAt,
      status: EnterpriseContractStatus.active,
    });

    const plan = await resolveOrganizationBillingPlan(ORG_ID, tx, now);

    assert.equal(plan.mode, "enterprise_contract");
    if (plan.mode !== "enterprise_contract") {
      return;
    }

    assert.equal(plan.isConsumable, false);
    assert.equal(plan.purchasedSeats, 5);
  });

  it("falls back to self_serve when no active enterprise contract exists", async () => {
    const tx = createTx(null);
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      id: "sub-1",
      periodEnd: new Date("2026-12-01T00:00:00.000Z"),
      plan: "starter",
      seats: 4,
      status: "active",
    });

    const plan = await resolveOrganizationBillingPlan(ORG_ID, tx);

    assert.equal(plan.mode, "self_serve");
    if (plan.mode !== "self_serve") {
      return;
    }

    assert.equal(plan.plan, "starter");
    assert.equal(plan.purchasedSeats, 4);
    assert.equal(plan.subscriptionId, "sub-1");
  });
});
