import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMessageMock = vi.fn();
const setTagMock = vi.fn();
const setContextMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  withScope: (
    callback: (scope: {
      setTag: typeof setTagMock;
      setContext: typeof setContextMock;
    }) => void,
  ) => {
    callback({ setTag: setTagMock, setContext: setContextMock });
  },
}));

describe("reportCoreAuthReadOutage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("reports 5xx auth reads as Sentry errors", async () => {
    const { reportCoreAuthReadOutage } = await import(
      "../core-auth-read-outage"
    );

    reportCoreAuthReadOutage(
      {
        path: "/auth/list-accounts",
        reason: "http",
        status: 503,
      },
      "Failed to fetch user accounts from Core",
    );

    expect(setTagMock).toHaveBeenCalledWith("context", "core_auth_read");
    expect(setTagMock).toHaveBeenCalledWith("path", "/auth/list-accounts");
    expect(setTagMock).toHaveBeenCalledWith("reason", "http");
    expect(setTagMock).toHaveBeenCalledWith("http_status", "503");
    expect(setContextMock).toHaveBeenCalledWith("core_auth_read", {
      message: "Failed to fetch user accounts from Core",
      path: "/auth/list-accounts",
      reason: "http",
      status: 503,
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to fetch user accounts from Core",
      "error",
    );
  });

  it("reports 4xx auth reads as Sentry warnings", async () => {
    const { reportCoreAuthReadOutage } = await import(
      "../core-auth-read-outage"
    );

    reportCoreAuthReadOutage(
      {
        path: "/auth/subscription/list",
        reason: "http",
        status: 401,
      },
      "Failed to fetch active subscriptions from Core",
    );

    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to fetch active subscriptions from Core",
      "warning",
    );
  });

  it("reports network and parse failures as Sentry errors", async () => {
    const { reportCoreAuthReadOutage } = await import(
      "../core-auth-read-outage"
    );

    reportCoreAuthReadOutage(
      {
        path: "/auth/oauth2/public-client",
        reason: "timeout",
      },
      "Failed to fetch OAuth client from Core",
    );

    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to fetch OAuth client from Core",
      "error",
    );
  });
});
