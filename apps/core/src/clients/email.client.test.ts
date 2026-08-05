import { beforeEach, describe, expect, it, vi } from "vitest";

import { shouldSuppressSentryForExternalError } from "@/lib/external-service-errors";

const { emailsSendMock, batchSendMock, resendConstructorMock } = vi.hoisted(
  () => ({
    emailsSendMock: vi.fn(),
    batchSendMock: vi.fn(),
    resendConstructorMock: vi.fn(),
  }),
);

vi.mock("resend", () => ({
  Resend: function Resend(...args: unknown[]) {
    resendConstructorMock(...args);
    return {
      emails: {
        send: (...sendArgs: unknown[]) => emailsSendMock(...sendArgs),
      },
      batch: {
        send: (...sendArgs: unknown[]) => batchSendMock(...sendArgs),
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

describe("sendEmails", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns empty without calling Resend when given no emails", async () => {
    const { sendEmails } = await import("./email.client");

    await expect(sendEmails([])).resolves.toEqual([]);
    expect(batchSendMock).not.toHaveBeenCalled();
    expect(emailsSendMock).not.toHaveBeenCalled();
  });

  it("sends one batch with category tags and returns ids in order", async () => {
    batchSendMock.mockResolvedValue({
      data: { data: [{ id: "email_1" }, { id: "email_2" }] },
      error: null,
    });

    const { sendEmails } = await import("./email.client");

    await expect(
      sendEmails([
        {
          to: "a@example.com",
          subject: "A",
          html: "<p>A</p>",
          tag: "job-final-status",
        },
        {
          to: "b@example.com",
          subject: "B",
          html: "<p>B</p>",
          tag: "job-input-required",
        },
      ]),
    ).resolves.toEqual([{ id: "email_1" }, { id: "email_2" }]);

    expect(batchSendMock).toHaveBeenCalledTimes(1);
    expect(batchSendMock).toHaveBeenCalledWith([
      {
        from: "no-reply@example.com",
        to: "a@example.com",
        subject: "A",
        html: "<p>A</p>",
        tags: [{ name: "category", value: "job-final-status" }],
      },
      {
        from: "no-reply@example.com",
        to: "b@example.com",
        subject: "B",
        html: "<p>B</p>",
        tags: [{ name: "category", value: "job-input-required" }],
      },
    ]);
    expect(emailsSendMock).not.toHaveBeenCalled();
  });

  it("passes bcc through on batch items", async () => {
    batchSendMock.mockResolvedValue({
      data: { data: [{ id: "email_bcc" }] },
      error: null,
    });

    const { sendEmails } = await import("./email.client");

    await sendEmails([
      {
        to: ["author@example.com"],
        bcc: ["ops@example.com"],
        subject: "Failure",
        html: "<p>Failed</p>",
        tag: "job-failure-notification",
      },
    ]);

    expect(batchSendMock).toHaveBeenCalledWith([
      {
        from: "no-reply@example.com",
        to: ["author@example.com"],
        bcc: ["ops@example.com"],
        subject: "Failure",
        html: "<p>Failed</p>",
        tags: [{ name: "category", value: "job-failure-notification" }],
      },
    ]);
  });

  it("chunks at RESEND_BATCH_MAX_SIZE so large sync bursts stay one request per 100", async () => {
    batchSendMock.mockImplementation(async (payload: unknown[]) => ({
      data: {
        data: payload.map((_, index) => ({ id: `email_${index}` })),
      },
      error: null,
    }));

    const { sendEmails, RESEND_BATCH_MAX_SIZE } = await import(
      "./email.client"
    );

    const inputs = Array.from(
      { length: RESEND_BATCH_MAX_SIZE + 1 },
      (_, index) => ({
        to: `user${index}@example.com`,
        subject: "Hello",
        html: "<p>Hi</p>",
        tag: "job-final-status",
      }),
    );

    const result = await sendEmails(inputs);

    expect(RESEND_BATCH_MAX_SIZE).toBe(100);
    expect(batchSendMock).toHaveBeenCalledTimes(2);
    expect(batchSendMock.mock.calls[0]?.[0]).toHaveLength(100);
    expect(batchSendMock.mock.calls[1]?.[0]).toHaveLength(1);
    expect(result).toHaveLength(RESEND_BATCH_MAX_SIZE + 1);
  });

  it("throws ErrorResponse fields when Resend batch returns an API error", async () => {
    batchSendMock.mockResolvedValue({
      data: null,
      error: {
        message: "rate_limit_exceeded",
        name: "rate_limit_exceeded",
        statusCode: 429,
      },
    });

    const { sendEmails } = await import("./email.client");

    await expect(
      sendEmails([
        {
          to: "user@example.com",
          subject: "Hello",
          html: "<p>Hi</p>",
          tag: "job-final-status",
        },
      ]),
    ).rejects.toMatchObject({
      message: "rate_limit_exceeded",
      name: "rate_limit_exceeded",
      statusCode: 429,
    });
  });

  it("throws when batch result length mismatches the chunk", async () => {
    batchSendMock.mockResolvedValue({
      data: { data: [{ id: "email_1" }] },
      error: null,
    });

    const { sendEmails } = await import("./email.client");

    await expect(
      sendEmails([
        {
          to: "a@example.com",
          subject: "A",
          html: "<p>A</p>",
          tag: "job-final-status",
        },
        {
          to: "b@example.com",
          subject: "B",
          html: "<p>B</p>",
          tag: "job-final-status",
        },
      ]),
    ).rejects.toThrow("Resend batch send returned unexpected result length");
  });

  it("throws when a batch item has no id", async () => {
    batchSendMock.mockResolvedValue({
      data: { data: [{}] },
      error: null,
    });

    const { sendEmails } = await import("./email.client");

    await expect(
      sendEmails([
        {
          to: "user@example.com",
          subject: "Hello",
          html: "<p>Hi</p>",
          tag: "job-final-status",
        },
      ]),
    ).rejects.toThrow("Resend batch send returned no id");
  });
});
