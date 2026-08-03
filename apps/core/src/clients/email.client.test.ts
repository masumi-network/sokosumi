import { beforeEach, describe, expect, it, vi } from "vitest";

import { shouldSuppressSentryForExternalError } from "@/lib/external-service-errors";

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

  it("passes bcc through to Resend", async () => {
    emailsSendMock.mockResolvedValue({
      data: { id: "email_bcc" },
      error: null,
    });

    const { sendEmail } = await import("./email.client");

    await sendEmail({
      to: ["author@example.com"],
      bcc: ["ops@example.com"],
      subject: "Failure",
      html: "<p>Failed</p>",
      tag: "job-failure-notification",
    });

    expect(emailsSendMock).toHaveBeenCalledWith({
      from: "no-reply@example.com",
      to: ["author@example.com"],
      bcc: ["ops@example.com"],
      subject: "Failure",
      html: "<p>Failed</p>",
      tags: [{ name: "category", value: "job-failure-notification" }],
    });
  });

  it("throws ErrorResponse fields when Resend returns an API error", async () => {
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
    ).rejects.toMatchObject({
      message: "Invalid API key",
      name: "invalid_api_key",
      statusCode: 401,
    });
  });

  it("throws a transient-classified error for Resend unresolved fetch", async () => {
    emailsSendMock.mockResolvedValue({
      data: null,
      error: {
        name: "application_error",
        statusCode: null,
        message: "Unable to fetch data. The request could not be resolved.",
      },
    });

    const { sendEmail } = await import("./email.client");

    try {
      await sendEmail({
        to: "user@example.com",
        subject: "Hello",
        html: "<p>Hi</p>",
        tag: "reset-password",
      });
      expect.unreachable("sendEmail should have thrown");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Unable to fetch data. The request could not be resolved.",
        name: "application_error",
        statusCode: null,
      });
      expect(shouldSuppressSentryForExternalError(error)).toBe(true);
    }
  });

  it("throws when Resend returns no id", async () => {
    emailsSendMock.mockResolvedValue({
      data: {},
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
    ).rejects.toThrow("Resend email send returned no id");
  });
});
