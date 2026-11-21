import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const captureMessageMock = vi.fn();

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    WEBHOOK_USER_CREATED: "https://example.test/user-created",
    WEBHOOK_USER_UPDATED: undefined,
    WEBHOOK_ACCOUNT_CREATED: undefined,
  }),
}));

vi.mock("@sentry/node", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

describe("webhookClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not call fetch when the webhook URL is not configured", async () => {
    const { webhookClient } = await import("./webhook.client");

    await webhookClient.callWebhook("userUpdated", { userId: "u1" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("posts to the configured URL and stays silent on success", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const { webhookClient } = await import("./webhook.client");

    await webhookClient.callWebhook("userCreated", { userId: "u1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/user-created",
      expect.objectContaining({ method: "POST" }),
    );
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("reports failures to Sentry as warnings", async () => {
    fetchMock.mockResolvedValue(
      new Response("kaboom", { status: 500, statusText: "Server Error" }),
    );
    const { webhookClient } = await import("./webhook.client");

    await webhookClient.callWebhook("userCreated", { userId: "u1" });

    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to call userCreated webhook",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({
          webhookType: "userCreated",
          responseStatus: 500,
        }),
      }),
    );
  });

  it("skips Sentry reporting on receiver backpressure", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "A webhook receiver's queue was full; the call is not reported to Sentry",
      ["The receiver answered that its queue is full"],
    );
    fetchMock.mockResolvedValue(
      new Response("The request queue reached full capacity.", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    const { webhookClient } = await import("./webhook.client");

    await webhookClient.callWebhook("userCreated", { userId: "u1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(warnings[0]?.event).toMatchObject({
      operation: "webhook_call",
      webhookType: "userCreated",
      status: 400,
    });
  });

  it("skips Sentry reporting on transient webhook timeouts", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "A webhook call failed transiently; it is not reported to Sentry",
      ["The call timed out or lost its connection"],
    );
    fetchMock.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      }),
    );
    const { webhookClient } = await import("./webhook.client");

    await webhookClient.callWebhook("userCreated", { userId: "u1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(warnings[0]?.event).toMatchObject({
      webhookType: "userCreated",
      // `postWebhook` rewraps a timeout as a plain Error.
      failure: { errorName: "Error" },
    });
  });

  it("keeps a transient failure's text out of the log", async () => {
    expectCoreLogWhys(
      "warn",
      "A webhook call failed transiently; it is not reported to Sentry",
      ["The call timed out or lost its connection"],
    );
    fetchMock.mockRejectedValue(
      Object.assign(
        new Error(
          "timed out after 5000ms posting ada@example.com to hook-secret-path",
        ),
        { name: "TimeoutError" },
      ),
    );
    const { webhookClient } = await import("./webhook.client");

    await webhookClient.callWebhook("userCreated", {
      email: "ada@example.com",
    });

    const drained = JSON.stringify(coreLogEvents());
    expect(drained).not.toContain("hook-secret-path");
    expect(drained).not.toContain("ada@");
  });
});
