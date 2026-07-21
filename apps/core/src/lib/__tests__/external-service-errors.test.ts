import { describe, expect, it } from "vitest";

import {
  isSchemaDriftPrismaError,
  isTransientFetchError,
  isTransientPostmarkError,
  isTransientPrismaError,
  shouldSuppressSentryForExternalError,
} from "@/lib/external-service-errors";

describe("isTransientFetchError", () => {
  it("treats fetch timeouts as transient", () => {
    expect(
      isTransientFetchError(
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        }),
      ),
    ).toBe(true);
  });

  it("treats webhook-style timeout messages as transient", () => {
    expect(
      isTransientFetchError(
        new Error("Webhook request timed out after 10000ms"),
      ),
    ).toBe(true);
  });

  it("treats dropped upstream connections as transient", () => {
    expect(
      isTransientFetchError(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
  });
});

describe("isTransientPostmarkError", () => {
  it("treats axios-era Postmark timeouts as transient", () => {
    expect(
      isTransientPostmarkError(
        Object.assign(new Error("timeout of 180000ms exceeded"), {
          name: "PostmarkError",
        }),
      ),
    ).toBe(true);
  });

  it("treats fetch-era Postmark timeouts as transient", () => {
    expect(
      isTransientPostmarkError(
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        }),
      ),
    ).toBe(true);
  });

  it("treats socket hang up as transient", () => {
    expect(isTransientPostmarkError(new Error("socket hang up"))).toBe(true);
  });

  it("does not treat unrelated errors as transient", () => {
    expect(isTransientPostmarkError(new Error("invalid API token"))).toBe(
      false,
    );
  });
});

describe("isTransientPrismaError", () => {
  it("treats DriverAdapterError cache lookup failures as transient", () => {
    expect(
      isTransientPrismaError(
        Object.assign(new Error("cache lookup failed for type 6170098"), {
          name: "DriverAdapterError",
        }),
      ),
    ).toBe(true);
  });

  it("treats P2034 serialization failures as transient", () => {
    expect(
      isTransientPrismaError(
        Object.assign(new Error("serialization failure"), { code: "P2034" }),
      ),
    ).toBe(true);
  });

  it("treats transaction start timeouts as transient", () => {
    expect(
      isTransientPrismaError(
        Object.assign(
          new Error(
            "Transaction API error: Unable to start a transaction in the given time.",
          ),
          { code: "P2028" },
        ),
      ),
    ).toBe(true);
  });

  it("treats dropped database connections as transient", () => {
    expect(
      isTransientPrismaError(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
  });
});

describe("isSchemaDriftPrismaError", () => {
  it("detects missing-column schema drift", () => {
    expect(
      isSchemaDriftPrismaError(
        Object.assign(
          new Error(
            "The column `Agent.demoInput` does not exist in the current database.",
          ),
          { code: "P2022" },
        ),
      ),
    ).toBe(true);
  });

  it("detects enum-value schema drift during deploy windows", () => {
    expect(
      isSchemaDriftPrismaError(
        Object.assign(
          new Error("Value 'CANCEL_REQUESTED' not found in enum 'TaskStatus'"),
          { code: "P2006" },
        ),
      ),
    ).toBe(true);
  });
});

describe("shouldSuppressSentryForExternalError", () => {
  it("suppresses known transient external failures", () => {
    expect(
      shouldSuppressSentryForExternalError(
        new Error("timeout of 180000ms exceeded"),
      ),
    ).toBe(true);
    expect(
      shouldSuppressSentryForExternalError(
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        }),
      ),
    ).toBe(true);
    expect(
      shouldSuppressSentryForExternalError(
        Object.assign(new Error("cache lookup failed for type 1"), {
          name: "DriverAdapterError",
        }),
      ),
    ).toBe(true);
    expect(
      shouldSuppressSentryForExternalError(
        Object.assign(
          new Error(
            "Transaction API error: Unable to start a transaction in the given time.",
          ),
          { code: "P2028" },
        ),
      ),
    ).toBe(true);
  });
});
