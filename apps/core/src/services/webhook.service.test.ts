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
    await webhookService.callUserCreated(validUser);

    expect(callWebhookMock).toHaveBeenCalledWith("userCreated", {
      userId: "user_1",
      email: "alice@example.com",
      name: "Alice",
      marketingOptIn: true,
    });
  });

  it("skips the user created webhook when the payload is invalid", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await webhookService.callUserCreated({ id: "user_1" });

    expect(callWebhookMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Invalid user data for user created webhook:",
      expect.anything(),
    );
    consoleError.mockRestore();
  });

  it("forwards a valid user updated payload", async () => {
    await webhookService.callUserUpdated({
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
