import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { resolveOrganizationBillingPlan } from "../helpers/organization-billing-plan.js";
import { creditBucketRepository } from "./credit-bucket.repository.js";
import { memberRepository } from "./member.repository.js";

vi.mock("../helpers/organization-billing-plan.js", () => ({
  resolveOrganizationBillingPlan: vi.fn(),
}));

vi.mock("./member.repository.js", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: vi.fn(),
  },
}));

const resolveOrganizationBillingPlanMock = vi.mocked(
  resolveOrganizationBillingPlan,
);
const getMemberByUserIdAndOrganizationIdMock = vi.mocked(
  memberRepository.getMemberByUserIdAndOrganizationId,
);

function extractNestedSqlValues(args: unknown[]): unknown[] {
  const sqlArg = args.find((arg) => {
    return (
      arg &&
      typeof arg === "object" &&
      "values" in arg &&
      Array.isArray((arg as { values: unknown }).values)
    );
  });

  if (!sqlArg || typeof sqlArg !== "object" || !("values" in sqlArg)) {
    return [];
  }

  const values = (sqlArg as { values: unknown[] }).values;
  return Array.isArray(values) ? values : [];
}

describe("creditBucketRepository.getBalance (consumable enterprise)", () => {
  it("returns zero for unassigned members with no in-scope buckets", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 5,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    const tx = {
      $queryRaw: async () => [{ balance: 0n }],
    } as unknown as Prisma.TransactionClient;

    const balance = await creditBucketRepository.getBalance(
      "user-unassigned",
      "org-1",
      tx,
    );

    assert.equal(balance, 0n);
  });

  it("scopes unassigned balance queries without enterprise or shared org buckets", async () => {
    let queryArgs: unknown[] = [];
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 5,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    const tx = {
      $queryRaw: async (...rawArgs: unknown[]) => {
        queryArgs = rawArgs;
        return [{ balance: 0n }];
      },
    } as unknown as Prisma.TransactionClient;

    await creditBucketRepository.getBalance("user-unassigned", "org-1", tx);

    const sqlText = JSON.stringify(queryArgs);
    assert.ok(sqlText.includes("FALSE"));
    assert.ok(
      !sqlText.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
    assert.ok(!sqlText.includes(CreditBucketReferenceType.ENTERPRISE_PERIOD));
    assert.ok(!sqlText.includes(CreditBucketReferenceType.ENTERPRISE_TOP_UP));
    assert.ok(!sqlText.includes('"referenceType" IS NULL'));
    assert.ok(!sqlText.includes("member:"));
    assert.ok(!sqlText.includes("LIKE"));

    const values = extractNestedSqlValues(queryArgs);
    assert.ok(values.includes("org-1"));
    assert.ok(!values.includes("user-unassigned"));
  });
});
