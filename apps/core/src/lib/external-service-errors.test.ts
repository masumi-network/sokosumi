import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureExternalServiceError,
  isSchemaDriftPrismaError,
  isTransientFetchError,
  isTransientPrismaError,
  isTransientUpstreamHttpError,
  shouldSuppressSentryForExternalError,
} from "@/lib/external-service-errors";
import { REDACTED_SECRET } from "@/lib/secret-redaction";
import { causeMessage, expectCoreLogWhys } from "@/test/core-log";

const { captureExceptionMock, setExtrasMock, withScopeMock } = vi.hoisted(
  () => {
    const setExtrasMock = vi.fn();
    const captureExceptionMock = vi.fn();
    const withScopeMock = vi.fn((callback: (scope: unknown) => void) => {
      callback({ setExtras: setExtrasMock });
    });
    return { captureExceptionMock, setExtrasMock, withScopeMock };
  },
);

vi.mock("@sentry/node", () => ({
  captureException: (error: unknown, hint?: unknown) =>
    captureExceptionMock(error, hint),
  withScope: (callback: (scope: unknown) => void) => withScopeMock(callback),
}));

/**
 * Set before any test body runs, because `getEnvSecrets` scans `process.env`
 * once and caches the result. A variable assigned inside a test would arrive
 * after the first suppressed-error log had already populated that cache.
 */
const ENV_SECRET = "sok1011-test-secret-value";
process.env.SOK_1011_TEST_API_KEY = ENV_SECRET;

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

  it("treats axios-era timeout messages as transient", () => {
    expect(
      isTransientFetchError(
        Object.assign(new Error("timeout of 180000ms exceeded"), {
          name: "Error",
        }),
      ),
    ).toBe(true);
  });

  it("treats socket hang up as transient", () => {
    expect(isTransientFetchError(new Error("socket hang up"))).toBe(true);
  });

  it("treats Resend unresolved-fetch Result errors as transient", () => {
    expect(
      isTransientFetchError(
        Object.assign(
          new Error("Unable to fetch data. The request could not be resolved."),
          {
            name: "application_error",
            statusCode: null,
          },
        ),
      ),
    ).toBe(true);
  });

  it("does not treat Resend API errors with HTTP status as transient", () => {
    expect(
      isTransientFetchError(
        Object.assign(new Error("Invalid API key"), {
          name: "invalid_api_key",
          statusCode: 401,
        }),
      ),
    ).toBe(false);
  });

  it("does not treat unrelated errors as transient", () => {
    expect(isTransientFetchError(new Error("invalid API token"))).toBe(false);
  });
});

describe("isTransientUpstreamHttpError", () => {
  it("treats a Cloudflare origin-unreachable status as transient", () => {
    // What a restarting Masumi payment node actually answers: Cloudflare's
    // 521 page, so the body is HTML and the status is the only usable signal.
    expect(
      isTransientUpstreamHttpError(
        Object.assign(new Error('purchase-diff 521: "<!DOCTYPE html>..."'), {
          statusCode: 521,
        }),
      ),
    ).toBe(true);
  });

  it("treats proxy gateway statuses as transient", () => {
    for (const statusCode of [408, 502, 503, 504, 520, 521, 522, 523, 524]) {
      expect(
        isTransientUpstreamHttpError(
          Object.assign(new Error(`upstream ${statusCode}`), { statusCode }),
        ),
      ).toBe(true);
    }
  });

  it("does not treat a rejection by the far side as transient", () => {
    for (const statusCode of [400, 401, 429, 500, 519, 525, 526, 527, 528]) {
      expect(
        isTransientUpstreamHttpError(
          Object.assign(new Error(`upstream ${statusCode}`), { statusCode }),
        ),
      ).toBe(false);
    }
  });

  it("does not treat an error without a status as transient", () => {
    expect(isTransientUpstreamHttpError(new Error("no status here"))).toBe(
      false,
    );
    expect(
      isTransientUpstreamHttpError(
        Object.assign(new Error("no response arrived"), { statusCode: null }),
      ),
    ).toBe(false);
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

  it("detects missing-table schema drift (P2021)", () => {
    expect(
      isSchemaDriftPrismaError(
        Object.assign(
          new Error(
            "The table `public.hermesInstance` does not exist in the current database.",
          ),
          {
            name: "PrismaClientKnownRequestError",
            code: "P2021",
          },
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
    expect(
      shouldSuppressSentryForExternalError(
        Object.assign(new Error("purchase-diff 521: proxy page"), {
          statusCode: 521,
        }),
      ),
    ).toBe(true);
  });

  it("still pages when the far side rejected the request", () => {
    expect(
      shouldSuppressSentryForExternalError(
        Object.assign(new Error("purchase-diff 401: unauthorized"), {
          statusCode: 401,
        }),
      ),
    ).toBe(false);
  });
});

const TRANSIENT_WHY =
  "The call failed in a way that usually clears on the next attempt: a timeout, a dropped connection, an upstream gateway error or a busy database";

describe("captureExternalServiceError", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    setExtrasMock.mockClear();
    withScopeMock.mockClear();
  });

  it("preserves schema-drift suppression severity with a fixed message", () => {
    const errors = expectCoreLogWhys(
      "error",
      "Kept a database schema mismatch out of Sentry",
      [
        "The database schema does not match this Core build, as happens while migrations deploy before the matching release",
      ],
    );

    captureExternalServiceError(
      Object.assign(new Error("andreas@example.com"), { code: "P2022" }),
      { label: "private-operation", message: "Operation failed" },
    );

    expect(captureExceptionMock).not.toHaveBeenCalled();
    // A fixed message marks private provider detail: safe fields, no cause.
    expect(errors[0]?.event).toMatchObject({
      operation: "external_service_failure",
      suppressedFailure: { label: "private-operation" },
      failure: { errorName: "Error", code: "P2022" },
    });
    expect(errors[0]?.cause).toBeUndefined();
    expect(JSON.stringify(errors[0]?.event)).not.toContain("andreas");
  });

  it("keeps the error text out unless the caller opts in", () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Kept a transient external failure out of Sentry",
      [TRANSIENT_WHY],
    );
    // A provider echoing the mail it was sending: its body, a one-time link
    // and a token no env secret matches. Redaction recognizes none of them.
    const error = Object.assign(
      new Error(
        "socket hang up sending <p>Your payroll for Q3 is attached</p> https://app.sokosumi.com/invite/tok_8f3k2j1h9g sk_live_abc123",
      ),
      { code: "ECONNRESET" },
    );

    captureExternalServiceError(error, { label: "data_room_email" });

    expect(warnings[0]?.cause).toBeUndefined();
    expect(warnings[0]?.event).toMatchObject({
      suppressedFailure: { label: "data_room_email" },
      failure: { errorName: "Error", code: "ECONNRESET" },
    });
    const drained = JSON.stringify(warnings[0]?.event);
    expect(drained).not.toContain("payroll");
    expect(drained).not.toContain("tok_8f3k2j1h9g");
    expect(drained).not.toContain("sk_live");
  });

  it("keeps the error text of a private failure out of a warning", () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Kept a transient external failure out of Sentry",
      [TRANSIENT_WHY],
    );

    captureExternalServiceError(
      new Error(`socket hang up for "Confidential payroll" sk_live_abc123`),
      { label: "private-operation", message: "Operation failed" },
    );

    expect(warnings[0]?.event).toMatchObject({
      failure: { errorName: "Error" },
    });
    const drained = JSON.stringify(warnings[0]?.event);
    expect(drained).not.toContain("Confidential payroll");
    expect(drained).not.toContain("sk_live");
  });

  it("applies top-level extra via scope and keeps sentry tags", () => {
    const error = new Error("permanent failure");

    captureExternalServiceError(error, {
      label: "reset_password_email",
      sentry: {
        tags: { context: "reset_password_email" },
      },
      extra: { userId: "user_1" },
    });

    expect(withScopeMock).toHaveBeenCalledOnce();
    expect(setExtrasMock).toHaveBeenCalledWith({ userId: "user_1" });
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      tags: { context: "reset_password_email" },
    });
  });

  it("masks an env secret echoed back inside the error message", () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Kept a transient external failure out of Sentry",
      [TRANSIENT_WHY],
    );
    // A gateway answering for an upstream can echo the request headers into
    // its error body. Sentry has `beforeSend`; stdout has only this.
    const error = new Error(`socket hang up (token: ${ENV_SECRET})`);

    captureExternalServiceError(error, {
      label: "job-final-status",
      errorDetail: "cause",
    });

    const cause = causeMessage(warnings[0]?.cause);
    expect(cause).not.toContain(ENV_SECRET);
    expect(cause).toContain(REDACTED_SECRET);
  });

  it("masks an env secret carried in extra", () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Kept a transient external failure out of Sentry",
      [TRANSIENT_WHY],
    );

    captureExternalServiceError(new Error("socket hang up"), {
      label: "job-final-status",
      extra: { upstreamMessage: `401 for key ${ENV_SECRET}` },
    });

    const payload = warnings[0]?.event as { upstreamMessage: string };
    expect(payload.upstreamMessage).not.toContain(ENV_SECRET);
    expect(payload.upstreamMessage).toContain(REDACTED_SECRET);
  });

  it("uses top-level extra for suppressed log context", () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Kept a transient external failure out of Sentry",
      [TRANSIENT_WHY],
      ["socket hang up"],
    );
    const error = new Error("socket hang up");

    captureExternalServiceError(error, {
      label: "job-final-status",
      extra: {
        jobId: "job_1",
        notificationType: "job-final-status",
      },
      errorDetail: "cause",
    });

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(warnings[0]?.event).toMatchObject({
      suppressedFailure: { label: "job-final-status" },
      jobId: "job_1",
      notificationType: "job-final-status",
    });
  });
});
