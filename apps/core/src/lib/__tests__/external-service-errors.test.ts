import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureExternalServiceError,
  isSchemaDriftPrismaError,
  isTransientFetchError,
  isTransientPrismaError,
  shouldSuppressSentryForExternalError,
} from "@/lib/external-service-errors";

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
  });
});

describe("captureExternalServiceError", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    setExtrasMock.mockClear();
    withScopeMock.mockClear();
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

  it("uses top-level extra for suppressed log context", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("socket hang up");

    try {
      captureExternalServiceError(error, {
        label: "job-final-status",
        extra: {
          jobId: "job_1",
          notificationType: "job-final-status",
        },
      });

      expect(captureExceptionMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "[job-final-status] suppressed external failure",
        {
          error: "socket hang up",
          jobId: "job_1",
          notificationType: "job-final-status",
        },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
