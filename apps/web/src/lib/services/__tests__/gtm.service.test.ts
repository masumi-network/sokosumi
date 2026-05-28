import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const captureMessageMock = vi.fn();
const getEnvSecretsMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: (...args: unknown[]) => getEnvSecretsMock(...args),
}));

describe("gtm.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    getEnvSecretsMock.mockReturnValue({
      ACCOUNT_CREATED_WEBHOOK: undefined,
      AGENT_HIRED_WEBHOOK: undefined,
      USER_CREATED_WEBHOOK: undefined,
      USER_UPDATED_WEBHOOK: "https://example.test/webhook",
    });
  });

  it("does not report webhook backpressure responses to Sentry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("The request queue reached full capacity.", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { callUserUpdatedWebHook } = await import("../gtm.service");

    await callUserUpdatedWebHook(
      "user-1",
      "user@example.test",
      "Test User",
      true,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
