import { beforeEach, describe, expect, it, vi } from "vitest";

const { emailsSendMock, resendConstructorMock } = vi.hoisted(() => ({
  emailsSendMock: vi.fn(),
  resendConstructorMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: function Resend(...args: unknown[]) {
    resendConstructorMock(...args);
    return {
      emails: {
        send: (...sendArgs: unknown[]) => emailsSendMock(...sendArgs),
      },
    };
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM_EMAIL: "no-reply@example.com",
  }),
}));

describe("sendEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("sends from RESEND_FROM_EMAIL with category tags and returns id", async () => {
    emailsSendMock.mockResolvedValue({
      data: { id: "email_123" },
      error: null,
    });

    const { sendEmail } = await import("./email.client");

    await expect(
      sendEmail({
        to: "user@example.com",
        subject: "Hello",
        html: "<p>Hi</p>",
        tag: "reset-password",
      }),
    ).resolves.toEqual({ id: "email_123" });

    expect(resendConstructorMock).toHaveBeenCalledWith("re_test_key");
    expect(emailsSendMock).toHaveBeenCalledWith({
      from: "no-reply@example.com",
      to: "user@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      tags: [{ name: "category", value: "reset-password" }],
    });
  });

  it("throws Error when Resend returns a plain-object error", async () => {
    emailsSendMock.mockResolvedValue({
      data: null,
      error: {
        message: "Invalid API key",
        name: "invalid_api_key",
        statusCode: 401,
      },
    });

    const { sendEmail } = await import("./email.client");

    await expect(
      sendEmail({
        to: "user@example.com",
        subject: "Hello",
        html: "<p>Hi</p>",
        tag: "magic-link",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid API key");
      expect((error as Error).name).toBe("invalid_api_key");
      return true;
    });
  });
});
