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
import { expectConsole } from "@/test/console";

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
    const consoleError = expectConsole(
      "error",
      "Invalid user data for userCreated webhook",
    );

    await webhookService.callUserWebhook("userCreated", { id: "user_1" });

    expect(callWebhookMock).not.toHaveBeenCalled();
    expect(consoleError).toContainEqual([
      "Invalid user data for userCreated webhook:",
      expect.anything(),
    ]);
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
