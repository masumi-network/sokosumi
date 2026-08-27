import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { EnterpriseContractStatus } from "../generated/prisma/client.js";
import {
  buildEnterpriseContractPeriodSchedule,
  deriveEnterpriseContractEndDate,
  isEnterpriseContractConsumable,
  MIN_ENTERPRISE_CREDITS_PER_MONTH,
  MIN_ENTERPRISE_PERIOD_COUNT,
  minEnterpriseCentsPerMonth,
  previewEnterpriseContractPeriods,
  validateEnterprisePeriodCount,
  validateMinEnterpriseCreditsPerMonth,
} from "./enterprise-contract.js";

const CENTS_PER_MONTH = 600_000_000_000_000n;

describe("validateMinEnterpriseCreditsPerMonth", () => {
  it("accepts the minimum credits", () => {
    assert.doesNotThrow(() =>
      validateMinEnterpriseCreditsPerMonth(MIN_ENTERPRISE_CREDITS_PER_MONTH),
    );
  });

  it("rejects credits below the minimum", () => {
    assert.throws(
      () => validateMinEnterpriseCreditsPerMonth(59_999),
      /at least 60000 credits per month/,
    );
  });

  it("maps the minimum to cents", () => {
    assert.equal(minEnterpriseCentsPerMonth(), 600_000_000_000_000n);
  });
});

describe("validateEnterprisePeriodCount", () => {
  it("accepts the minimum period count", () => {
    assert.doesNotThrow(() =>
      validateEnterprisePeriodCount(MIN_ENTERPRISE_PERIOD_COUNT),
    );
  });

  it("rejects zero or negative period counts", () => {
    assert.throws(() => validateEnterprisePeriodCount(0), /at least 1 period/);
    assert.throws(() => validateEnterprisePeriodCount(-1), /at least 1 period/);
  });

  it("rejects non-integer period counts", () => {
    assert.throws(
      () => validateEnterprisePeriodCount(1.5),
      /at least 1 period/,
    );
  });
});

describe("deriveEnterpriseContractEndDate", () => {
  it("returns the last period end for a multi-period contract", () => {
    const activatedAt = new Date("2026-04-15T10:00:00.000Z");

    assert.equal(
      deriveEnterpriseContractEndDate(activatedAt, 3).toISOString(),
      "2026-07-15T09:59:59.999Z",
    );
  });

  it("throws when periodCount is below the minimum", () => {
    assert.throws(
      () =>
        deriveEnterpriseContractEndDate(
          new Date("2026-04-15T10:00:00.000Z"),
          0,
        ),
      /at least 1 period/,
    );
  });

  it("matches the last period end from buildEnterpriseContractPeriodSchedule", () => {
    const cases = [
      { periodCount: 1, activatedAt: new Date("2026-06-15T10:00:00.000Z") },
      { periodCount: 2, activatedAt: new Date("2026-01-31T09:00:00.000Z") },
      { periodCount: 3, activatedAt: new Date("2026-04-15T10:00:00.000Z") },
      { periodCount: 12, activatedAt: new Date("2026-01-31T00:00:00.000Z") },
    ];

    for (const { periodCount, activatedAt } of cases) {
      const periods = buildEnterpriseContractPeriodSchedule({
        centsPerMonth: CENTS_PER_MONTH,
        periodCount,
        purchasedSeats: 1,
        activatedAt,
      });
      const derived = deriveEnterpriseContractEndDate(activatedAt, periodCount);
      const lastPeriod = periods.at(-1);

      assert.equal(
        derived.toISOString(),
        lastPeriod?.periodEnd.toISOString(),
        `periodCount ${periodCount} starting ${activatedAt.toISOString()}`,
      );
    }
  });
});

describe("buildEnterpriseContractPeriodSchedule", () => {
  it("builds one rolling month per period from each period start", () => {
    const periods = buildEnterpriseContractPeriodSchedule({
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 3,
      purchasedSeats: 10,
      activatedAt: new Date("2026-04-15T10:00:00.000Z"),
    });

    assert.equal(periods.length, 3);
    assert.equal(
      periods[0]?.periodStart.toISOString(),
      "2026-04-15T10:00:00.000Z",
    );
    assert.equal(
      periods[0]?.periodEnd.toISOString(),
      "2026-05-15T09:59:59.999Z",
    );
    assert.equal(periods[0]?.centsToGrant, CENTS_PER_MONTH);
    assert.equal(
      periods[1]?.periodStart.toISOString(),
      "2026-05-15T10:00:00.000Z",
    );
    assert.equal(
      periods[1]?.periodEnd.toISOString(),
      "2026-06-15T09:59:59.999Z",
    );
    assert.equal(
      periods[2]?.periodStart.toISOString(),
      "2026-06-15T10:00:00.000Z",
    );
    assert.equal(
      periods[2]?.periodEnd.toISOString(),
      "2026-07-15T09:59:59.999Z",
    );
    assert.ok(
      periods.every(
        (period) =>
          period.centsToGrant === CENTS_PER_MONTH &&
          period.purchasedSeats === 10,
      ),
    );
  });

  it("advances january 31 starts by one month at a time", () => {
    const periods = buildEnterpriseContractPeriodSchedule({
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 2,
      purchasedSeats: 5,
      activatedAt: new Date("2026-01-31T09:00:00.000Z"),
    });

    assert.equal(periods.length, 2);
    assert.equal(
      periods[0]?.periodStart.toISOString(),
      "2026-01-31T09:00:00.000Z",
    );
    assert.equal(
      periods[0]?.periodEnd.toISOString(),
      "2026-02-28T08:59:59.999Z",
    );
    assert.equal(
      periods[1]?.periodStart.toISOString(),
      "2026-02-28T09:00:00.000Z",
    );
    assert.equal(
      periods[1]?.periodEnd.toISOString(),
      "2026-03-31T08:59:59.999Z",
    );
  });

  it("handles leap-year february when rolling from january 31", () => {
    const periods = buildEnterpriseContractPeriodSchedule({
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 2,
      purchasedSeats: 3,
      activatedAt: new Date("2028-01-31T10:00:00.000Z"),
    });

    assert.equal(
      periods[0]?.periodEnd.toISOString(),
      "2028-02-29T09:59:59.999Z",
    );
    assert.equal(
      periods[1]?.periodStart.toISOString(),
      "2028-02-29T10:00:00.000Z",
    );
    assert.equal(
      periods[1]?.periodEnd.toISOString(),
      "2028-03-31T09:59:59.999Z",
    );
  });

  it("returns no periods when periodCount is below the minimum", () => {
    const periods = buildEnterpriseContractPeriodSchedule({
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 0,
      purchasedSeats: 1,
      activatedAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    assert.deepEqual(periods, []);
  });

  it("builds one full rolling month for a single-period contract", () => {
    const periods = buildEnterpriseContractPeriodSchedule({
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 1,
      purchasedSeats: 1,
      activatedAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    assert.equal(periods.length, 1);
    assert.equal(
      periods[0]?.periodStart.toISOString(),
      "2026-06-15T10:00:00.000Z",
    );
    assert.equal(
      periods[0]?.periodEnd.toISOString(),
      "2026-07-15T09:59:59.999Z",
    );
    assert.equal(periods[0]?.centsToGrant, CENTS_PER_MONTH);
  });
});

describe("previewEnterpriseContractPeriods", () => {
  it("anchors the schedule at activatedAt", () => {
    const activatedAt = new Date("2026-04-01T08:00:00.000Z");
    const periods = previewEnterpriseContractPeriods({
      activatedAt,
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 2,
      purchasedSeats: 2,
    });

    assert.equal(
      periods[0]?.periodStart.toISOString(),
      activatedAt.toISOString(),
    );
    assert.equal(periods.length, 2);
  });
});

describe("isEnterpriseContractConsumable", () => {
  const activatedAt = new Date("2026-05-01T00:00:00.000Z");
  const periodCount = 8;

  it("is true within the consumable window", () => {
    assert.equal(
      isEnterpriseContractConsumable({
        now: new Date("2026-06-01T00:00:00.000Z"),
        periodCount,
        activatedAt,
        status: EnterpriseContractStatus.active,
      }),
      true,
    );
  });

  it("is true at the exact contract end (inclusive boundary)", () => {
    const endsAt = deriveEnterpriseContractEndDate(activatedAt, periodCount);

    assert.equal(
      isEnterpriseContractConsumable({
        now: endsAt,
        periodCount,
        activatedAt,
        status: EnterpriseContractStatus.active,
      }),
      true,
    );
  });

  it("is false after the last period ends", () => {
    const endsAt = deriveEnterpriseContractEndDate(activatedAt, periodCount);

    assert.equal(
      isEnterpriseContractConsumable({
        now: new Date(endsAt.getTime() + 1),
        periodCount,
        activatedAt,
        status: EnterpriseContractStatus.active,
      }),
      false,
    );
  });

  it("is false for non-active statuses", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");

    for (const status of [
      EnterpriseContractStatus.canceled,
      EnterpriseContractStatus.completed,
      EnterpriseContractStatus.draft,
    ]) {
      assert.equal(
        isEnterpriseContractConsumable({
          now,
          periodCount,
          activatedAt,
          status,
        }),
        false,
        status,
      );
    }
  });
});
