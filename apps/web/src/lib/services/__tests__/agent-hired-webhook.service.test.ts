import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const captureMessageMock = vi.fn();
const getEnvSecretsMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: (...args: unknown[]) => getEnvSecretsMock(...args),
}));

describe("agent-hired-webhook.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    getEnvSecretsMock.mockReturnValue({
      AGENT_HIRED_WEBHOOK: "https://example.test/webhook",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays silent when the webhook succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { callAgentHiredWebHook } = await import(
      "../agent-hired-webhook.service"
    );

    await callAgentHiredWebHook("user-1", "user@example.test");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("reports webhook failures to Sentry with user context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("kaboom", { status: 500, statusText: "Server Error" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { callAgentHiredWebHook } = await import(
      "../agent-hired-webhook.service"
    );

    await callAgentHiredWebHook("user-1", "user@example.test");

    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to call agentHired webhook",
      expect.objectContaining({
        level: "warning",
        user: { userId: "user-1" },
        extra: expect.objectContaining({
          webhookType: "agentHired",
          responseStatus: 500,
        }),
      }),
    );
  });

  it("does not report webhook backpressure responses to Sentry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("The request queue reached full capacity.", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { callAgentHiredWebHook } = await import(
      "../agent-hired-webhook.service"
    );

    await callAgentHiredWebHook("user-1", "user@example.test");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
