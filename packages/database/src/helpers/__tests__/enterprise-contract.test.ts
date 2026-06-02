import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { EnterpriseContractStatus } from "../../generated/prisma/client.js";
import {
  buildEnterpriseContractPeriodSchedule,
  deriveEnterpriseContractEndDate,
  isEnterpriseContractActive,
  MIN_ENTERPRISE_CREDITS_PER_MONTH,
  MIN_ENTERPRISE_PERIOD_COUNT,
  minEnterpriseCentsPerMonth,
  previewEnterpriseContractPeriods,
  resolveContractStartDate,
  validateEnterprisePeriodCount,
  validateMinEnterpriseCreditsPerMonth,
} from "../enterprise-contract.js";

const CENTS_PER_MONTH = 600_000_000_000_000n;

describe("resolveContractStartDate", () => {
  it("uses activatedAt when startDate is unset", () => {
    const activatedAt = new Date("2026-04-01T12:00:00.000Z");

    assert.equal(
      resolveContractStartDate(null, activatedAt).toISOString(),
      activatedAt.toISOString(),
    );
  });

  it("preserves an explicit future startDate", () => {
    const activatedAt = new Date("2026-04-01T12:00:00.000Z");
    const startDate = new Date("2026-05-01T00:00:00.000Z");

    assert.equal(
      resolveContractStartDate(startDate, activatedAt).toISOString(),
      startDate.toISOString(),
    );
  });
});

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
    const startDate = new Date("2026-04-15T10:00:00.000Z");

    assert.equal(
      deriveEnterpriseContractEndDate(startDate, 3).toISOString(),
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
      { periodCount: 1, startDate: new Date("2026-06-15T10:00:00.000Z") },
      { periodCount: 2, startDate: new Date("2026-01-31T09:00:00.000Z") },
      { periodCount: 3, startDate: new Date("2026-04-15T10:00:00.000Z") },
      { periodCount: 12, startDate: new Date("2026-01-31T00:00:00.000Z") },
    ];

    for (const { periodCount, startDate } of cases) {
      const periods = buildEnterpriseContractPeriodSchedule({
        centsPerMonth: CENTS_PER_MONTH,
        periodCount,
        purchasedSeats: 1,
        startDate,
      });
      const derived = deriveEnterpriseContractEndDate(startDate, periodCount);
      const lastPeriod = periods.at(-1);

      assert.equal(
        derived.toISOString(),
        lastPeriod?.periodEnd.toISOString(),
        `periodCount ${periodCount} starting ${startDate.toISOString()}`,
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
      startDate: new Date("2026-04-15T10:00:00.000Z"),
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
      startDate: new Date("2026-01-31T09:00:00.000Z"),
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
      startDate: new Date("2028-01-31T10:00:00.000Z"),
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
      startDate: new Date("2026-06-15T10:00:00.000Z"),
    });

    assert.deepEqual(periods, []);
  });

  it("builds one full rolling month for a single-period contract", () => {
    const periods = buildEnterpriseContractPeriodSchedule({
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 1,
      purchasedSeats: 1,
      startDate: new Date("2026-06-15T10:00:00.000Z"),
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
  it("uses activatedAt when startDate is unset", () => {
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
  });

  it("schedules from a future startDate even when activated earlier", () => {
    const periods = previewEnterpriseContractPeriods({
      activatedAt: new Date("2026-04-01T08:00:00.000Z"),
      centsPerMonth: CENTS_PER_MONTH,
      periodCount: 3,
      purchasedSeats: 2,
      startDate: new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(
      periods[0]?.periodStart.toISOString(),
      "2026-05-01T00:00:00.000Z",
    );
    assert.equal(periods.length, 3);
  });
});

describe("isEnterpriseContractActive", () => {
  const startDate = new Date("2026-05-01T00:00:00.000Z");
  const periodCount = 8;

  it("is false before startDate even when status is active", () => {
    assert.equal(
      isEnterpriseContractActive({
        now: new Date("2026-04-30T23:59:59.999Z"),
        periodCount,
        startDate,
        status: EnterpriseContractStatus.active,
      }),
      false,
    );
  });

  it("is true within the consumable window", () => {
    assert.equal(
      isEnterpriseContractActive({
        now: new Date("2026-06-01T00:00:00.000Z"),
        periodCount,
        startDate,
        status: EnterpriseContractStatus.active,
      }),
      true,
    );
  });

  it("is true at the exact contract end (inclusive boundary)", () => {
    const contractEnd = deriveEnterpriseContractEndDate(startDate, periodCount);

    assert.equal(
      isEnterpriseContractActive({
        now: contractEnd,
        periodCount,
        startDate,
        status: EnterpriseContractStatus.active,
      }),
      true,
    );
  });

  it("is false after the last period ends", () => {
    const contractEnd = deriveEnterpriseContractEndDate(startDate, periodCount);

    assert.equal(
      isEnterpriseContractActive({
        now: new Date(contractEnd.getTime() + 1),
        periodCount,
        startDate,
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
        isEnterpriseContractActive({
          now,
          periodCount,
          startDate,
          status,
        }),
        false,
        status,
      );
    }
  });
});
