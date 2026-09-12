import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  buildOrganizationInvoiceCreditReferenceId,
  buildUserInvoiceCreditReferenceId,
  creditBucketActivatesAtOrBefore,
  creditBucketActivatesAtOrBeforeSql,
  getCreditExpiryDate,
} from "./credit.js";

describe("creditBucketActivatesAtOrBefore", () => {
  it("returns Prisma filter for immediate or started buckets", () => {
    const now = new Date("2026-04-10T12:00:00.000Z");

    assert.deepEqual(creditBucketActivatesAtOrBefore(now), {
      OR: [{ activatesAt: null }, { activatesAt: { lte: now } }],
    });
  });
});

describe("creditBucketActivatesAtOrBeforeSql", () => {
  it("returns SQL fragment matching spendable activation predicate", () => {
    const now = new Date("2026-04-10T12:00:00.000Z");
    const fragment = creditBucketActivatesAtOrBeforeSql(now);
    const sqlText = JSON.stringify(fragment);

    assert.ok(sqlText.includes("activatesAt"));
    assert.ok(sqlText.includes("IS NULL"));
    assert.ok(sqlText.includes(now.toISOString()));
  });
});

describe("invoice credit reference builders", () => {
  it("builds user invoice reference ids", () => {
    assert.equal(
      buildUserInvoiceCreditReferenceId("user-1", "in_123", "subscription"),
      "user:user-1:in_123:subscription",
    );
    assert.equal(
      buildUserInvoiceCreditReferenceId("user-1", "in_123", "topup"),
      "user:user-1:in_123:topup",
    );
  });

  it("builds organization invoice reference ids", () => {
    assert.equal(
      buildOrganizationInvoiceCreditReferenceId("org-1", "in_123", "topup"),
      "org:org-1:in_123:topup",
    );
  });

  it("throws when required values are missing", () => {
    assert.throws(
      () => buildUserInvoiceCreditReferenceId("", "in_123", "subscription"),
      /userId is required/,
    );
    assert.throws(
      () => buildOrganizationInvoiceCreditReferenceId("org-1", "", "topup"),
      /invoiceId is required/,
    );
  });
});

describe("credit expiration policy", () => {
  it("calculates expiration date from a base date and day count", () => {
    const baseDate = new Date("2026-02-27T00:00:00.000Z");
    const expiryDate = getCreditExpiryDate(baseDate, 30);
    assert.equal(expiryDate.toISOString(), "2026-03-29T00:00:00.000Z");
  });

  it("throws for invalid day values", () => {
    assert.throws(() => getCreditExpiryDate(new Date(), -1), /Expiry days/);
    assert.throws(() => getCreditExpiryDate(new Date(), 1.5), /Expiry days/);
  });
});
