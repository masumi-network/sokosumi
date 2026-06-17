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

describe("agent-hired-webhook.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    getEnvSecretsMock.mockReturnValue({
      AGENT_HIRED_WEBHOOK: "https://example.test/webhook",
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

    const { callAgentHiredWebHook } = await import(
      "../agent-hired-webhook.service"
    );

    await callAgentHiredWebHook("user-1", "user@example.test");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
