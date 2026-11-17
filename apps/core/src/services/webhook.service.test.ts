import { beforeEach, describe, expect, it, vi } from "vitest";

const { callWebhookMock } = vi.hoisted(() => ({
  callWebhookMock: vi.fn(),
}));

vi.mock("@/clients/webhook.client", () => ({
  webhookClient: {
    callWebhook: (...args: unknown[]) => callWebhookMock(...args),
  },
}));

import { webhookService } from "@/services/webhook.service";
import { expectCoreLogWhys } from "@/test/core-log";

const validUser = {
  id: "user_1",
  email: "alice@example.com",
  name: "Alice",
  marketingOptIn: true,
};

describe("webhookService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callWebhookMock.mockResolvedValue(undefined);
  });

  it("forwards a valid user created payload", async () => {
    await webhookService.callUserWebhook("userCreated", validUser);

    expect(callWebhookMock).toHaveBeenCalledWith("userCreated", {
      userId: "user_1",
      email: "alice@example.com",
      name: "Alice",
      marketingOptIn: true,
    });
  });

  it("skips the user created webhook when the payload is invalid", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Skipped a user webhook, because the user data is invalid",
      ["The user has no valid id, email, name or marketing opt-in"],
    );

    await webhookService.callUserWebhook("userCreated", {
      id: "user_1",
      email: "alice@example.com",
      name: 42,
    });

    expect(callWebhookMock).not.toHaveBeenCalled();
    // Paths and codes only, never the user's values.
    expect(errors[0]?.event).toMatchObject({
      operation: "user_webhook",
      userWebhook: { type: "userCreated" },
      invalidFields: [
        { path: "name", code: "invalid_type" },
        { path: "marketingOptIn", code: "invalid_type" },
      ],
    });
    expect(JSON.stringify(errors[0]?.event)).not.toContain("alice");
  });

  it("forwards a valid user updated payload", async () => {
    await webhookService.callUserWebhook("userUpdated", {
      ...validUser,
      marketingOptIn: false,
    });

    expect(callWebhookMock).toHaveBeenCalledWith("userUpdated", {
      userId: "user_1",
      email: "alice@example.com",
      name: "Alice",
      marketingOptIn: false,
    });
  });

  it("forwards account created payloads without extra validation", async () => {
    await webhookService.callAccountCreated("user_1", "google");

    expect(callWebhookMock).toHaveBeenCalledWith("accountCreated", {
      userId: "user_1",
      providerId: "google",
    });
  });
});
