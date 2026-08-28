import assert from "node:assert/strict";

import { beforeEach, describe, it, vi } from "vitest";

import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  buildCreditBucketScopeSql,
  buildCreditBucketScopeWhere,
  buildEnterprisePoolScopeWhere,
  type CreditBucketScopeContext,
  hasAssignedOrganizationSeat,
  resolveCreditBucketScopeContext,
} from "./credit-bucket-scope.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";

vi.mock("./organization-billing-plan.js", () => ({
  resolveOrganizationBillingPlan: vi.fn(),
}));

vi.mock("../repositories/member.repository.js", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: vi.fn(),
  },
}));

import { memberRepository } from "../repositories/member.repository.js";

const resolveOrganizationBillingPlanMock = vi.mocked(
  resolveOrganizationBillingPlan,
);
const getMemberMock = vi.mocked(
  memberRepository.getMemberByUserIdAndOrganizationId,
);

function organizationContext(
  poolAccess: "none" | "shared" | "enterprise",
): CreditBucketScopeContext {
  return {
    workspace: "organization",
    userId: "user-1",
    organizationId: "org-1",
    poolAccess,
  };
}

function hasLeftoverMemberStartsWith(
  where: Prisma.CreditBucketWhereInput,
): boolean {
  return (where.OR ?? []).some((branch) => {
    const referenceId = branch.referenceId;
    return (
      typeof referenceId === "object" &&
      referenceId !== null &&
      "startsWith" in referenceId &&
      String(referenceId.startsWith).startsWith("member:")
    );
  });
}

function findNotInBranch(where: Prisma.CreditBucketWhereInput) {
  return (where.OR ?? []).find((branch) => {
    const referenceType = branch.referenceType;
    return (
      referenceType !== null &&
      typeof referenceType === "object" &&
      "notIn" in referenceType
    );
  });
}

function sqlFragmentText(sql: Prisma.Sql): string {
  return sql.strings.join("");
}

describe("resolveCreditBucketScopeContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows full personal scope without org lookups", async () => {
    const tx = {} as never;

    const context = await resolveCreditBucketScopeContext("user-1", null, tx);

    assert.deepEqual(context, {
      workspace: "personal",
      userId: "user-1",
    });
    assert.equal(resolveOrganizationBillingPlanMock.mock.calls.length, 0);
  });

  it("denies shared and enterprise pool for unassigned members under consumable enterprise", async () => {
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
    getMemberMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.deepEqual(context, {
      workspace: "organization",
      userId: "user-1",
      organizationId: "org-1",
      poolAccess: "none",
    });
  });

  it("allows enterprise pool for assigned members under consumable enterprise", async () => {
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
    getMemberMock.mockResolvedValue({
      seatAssignedAt: new Date("2026-02-01T00:00:00.000Z"),
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.deepEqual(context, {
      workspace: "organization",
      userId: "user-1",
      organizationId: "org-1",
      poolAccess: "enterprise",
    });
    assert.ok(buildEnterprisePoolScopeWhere(context));
  });

  it("allows shared pool for unassigned members on a free organization", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      subscriptionId: "sub-free",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.deepEqual(context, {
      workspace: "organization",
      userId: "user-1",
      organizationId: "org-1",
      poolAccess: "shared",
    });
  });

  it("denies shared pool for unassigned members on a paid self-serve organization", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 5,
      subscriptionId: "sub-paid",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.deepEqual(context, {
      workspace: "organization",
      userId: "user-1",
      organizationId: "org-1",
      poolAccess: "none",
    });
  });

  it("denies shared pool for unassigned members on a post-term enterprise contract", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: false,
      purchasedSeats: 5,
      contractId: "contract-1",
      endsAt: new Date("2026-02-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.deepEqual(context, {
      workspace: "organization",
      userId: "user-1",
      organizationId: "org-1",
      poolAccess: "none",
    });
  });

  it("allows shared pool for assigned members on a paid self-serve organization", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 5,
      subscriptionId: "sub-paid",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: new Date("2026-02-01T00:00:00.000Z"),
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.deepEqual(context, {
      workspace: "organization",
      userId: "user-1",
      organizationId: "org-1",
      poolAccess: "shared",
    });
  });

  it("denies pool access when the user is not an organization member", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      subscriptionId: "sub-free",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue(null);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.deepEqual(context, {
      workspace: "organization",
      userId: "user-1",
      organizationId: "org-1",
      poolAccess: "none",
    });
  });
});

describe("hasAssignedOrganizationSeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows personal workspace without org lookups", async () => {
    const allowed = await hasAssignedOrganizationSeat(
      "user-1",
      null,
      {} as never,
    );

    assert.equal(allowed, true);
    assert.equal(resolveOrganizationBillingPlanMock.mock.calls.length, 0);
  });

  it("allows unassigned members on a free organization", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      subscriptionId: "sub-free",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    assert.equal(
      await hasAssignedOrganizationSeat("user-1", "org-1", {} as never),
      true,
    );
  });

  it("denies non-members on a free organization", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      subscriptionId: "sub-free",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue(null);

    assert.equal(
      await hasAssignedOrganizationSeat("user-1", "org-1", {} as never),
      false,
    );
  });

  it("denies unassigned members on a paid organization", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 5,
      subscriptionId: "sub-paid",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    assert.equal(
      await hasAssignedOrganizationSeat("user-1", "org-1", {} as never),
      false,
    );
  });
});

describe("buildCreditBucketScopeWhere", () => {
  it("keeps personal scope as userId plus null organizationId", () => {
    const where = buildCreditBucketScopeWhere({
      workspace: "personal",
      userId: "user-1",
    });

    assert.deepEqual(where, {
      userId: "user-1",
      organizationId: null,
    });
  });

  it("matches nothing for unseated org spend without leftover member: branch", () => {
    const where = buildCreditBucketScopeWhere(organizationContext("none"));

    assert.equal(where.OR, undefined);
    assert.equal(hasLeftoverMemberStartsWith(where), false);
    assert.equal(JSON.stringify(where).includes("member:user-1:"), false);
    assert.deepEqual(where, {
      organizationId: "org-1",
      id: { equals: "" },
    });
  });

  it("includes org-owned subscription period buckets when shared access is allowed", () => {
    const where = buildCreditBucketScopeWhere(organizationContext("shared"));

    assert.equal(hasLeftoverMemberStartsWith(where), false);
    assert.ok(
      (where.OR ?? []).some(
        (branch) =>
          branch.referenceType ===
            CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD &&
          branch.userId === null,
      ),
    );
  });

  it("does not match leftover member: remaining from unseated or seated shared scope", () => {
    const unseated = buildCreditBucketScopeWhere(organizationContext("none"));
    const seated = buildCreditBucketScopeWhere(organizationContext("shared"));

    assert.equal(hasLeftoverMemberStartsWith(unseated), false);
    assert.equal(hasLeftoverMemberStartsWith(seated), false);
    assert.equal(
      (seated.OR ?? []).some(
        (branch) =>
          branch.referenceType ===
            CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD &&
          typeof branch.userId === "string",
      ),
      false,
    );
    const notInBranch = findNotInBranch(seated);
    assert.ok(notInBranch);
    const notIn = (
      notInBranch.referenceType as {
        notIn: CreditBucketReferenceType[];
      }
    ).notIn;
    assert.ok(
      notIn.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
  });

  it("keeps REFUND in the notIn shared branch with no userId filter", () => {
    const where = buildCreditBucketScopeWhere(organizationContext("shared"));
    const notInBranch = findNotInBranch(where);

    assert.ok(notInBranch);
    const notIn = (
      notInBranch.referenceType as {
        notIn: CreditBucketReferenceType[];
      }
    ).notIn;
    assert.ok(
      notIn.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
    assert.ok(notIn.includes(CreditBucketReferenceType.ENTERPRISE_PERIOD));
    assert.ok(notIn.includes(CreditBucketReferenceType.ENTERPRISE_TOP_UP));
    assert.equal(notIn.includes(CreditBucketReferenceType.REFUND), false);
    assert.equal("userId" in notInBranch, false);
  });

  it("includes enterprise pool branch only when assigned and consumable", () => {
    const where = buildCreditBucketScopeWhere(
      organizationContext("enterprise"),
    );

    const referenceTypes = (where.OR ?? []).map(
      (branch) => branch.referenceType,
    );
    assert.ok(
      referenceTypes.some(
        (value) =>
          value &&
          typeof value === "object" &&
          "in" in value &&
          Array.isArray(value.in) &&
          value.in.includes(CreditBucketReferenceType.ENTERPRISE_PERIOD),
      ),
    );
  });
});

describe("buildCreditBucketScopeSql", () => {
  it("keeps personal SQL as userId plus null organizationId", () => {
    const sql = buildCreditBucketScopeSql({
      workspace: "personal",
      userId: "user-1",
    });
    const fragment = sqlFragmentText(sql);
    const sqlText = JSON.stringify(sql);

    assert.ok(fragment.includes('cb."userId"'));
    assert.ok(fragment.includes('cb."organizationId" IS NULL'));
    assert.ok(sqlText.includes("user-1"));
    assert.ok(!sqlText.includes("member:"));
  });

  it("uses AND FALSE for unseated org SQL and does not bind leftover or spender userId", () => {
    const sql = buildCreditBucketScopeSql(organizationContext("none"));
    const fragment = sqlFragmentText(sql);
    const sqlText = JSON.stringify(sql);

    assert.ok(fragment.includes("FALSE"));
    assert.ok(sqlText.includes("org-1"));
    assert.ok(!fragment.includes("LIKE"));
    assert.ok(!sqlText.includes("member:"));
    assert.ok(!sqlText.includes("user-1"));
    assert.ok(
      !sqlText.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
    assert.ok(!sqlText.includes(CreditBucketReferenceType.ENTERPRISE_PERIOD));
    assert.ok(!fragment.includes('cb."referenceType" IS NULL'));
  });

  it("builds seated SQL from shared predicates without leftover member: matching", () => {
    const sql = buildCreditBucketScopeSql(organizationContext("shared"));
    const fragment = sqlFragmentText(sql);
    const sqlText = JSON.stringify(sql);

    assert.ok(fragment.includes('cb."referenceType" IS NULL'));
    assert.ok(fragment.includes('cb."userId" IS NULL'));
    assert.ok(fragment.includes("IS DISTINCT FROM"));
    assert.ok(
      sqlText.includes(CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD),
    );
    assert.ok(!fragment.includes("LIKE"));
    assert.ok(!sqlText.includes("member:"));
    assert.ok(!sqlText.includes("user-1"));
    assert.ok(!sqlText.includes("member:user-1:%"));
  });
});
