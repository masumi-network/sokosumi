import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const createInvitationMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const headersMock = vi.fn();
const syncOrganizationInvoiceEmailWithStripeMock = vi.fn();
const updateOrganizationInvoiceEmailMock = vi.fn();

class MockCoreApiRequestError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    updateOrganizationInvoiceEmail: (...args: unknown[]) =>
      updateOrganizationInvoiceEmailMock(...args),
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      createInvitation: (...args: unknown[]) => createInvitationMock(...args),
    },
  },
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@sokosumi/database/repositories", () => ({
  invitationRepository: {},
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
  organizationRepository: {},
}));

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("@/lib/services/preferred-organization.service", () => ({
  preferredOrganizationService: {},
}));

vi.mock("@/lib/services/stripe.service", () => ({
  stripeService: {
    syncOrganizationInvoiceEmailWithStripe: (...args: unknown[]) =>
      syncOrganizationInvoiceEmailWithStripeMock(...args),
  },
}));

const session = {
  user: {
    id: "user-1",
  },
} as never;

describe("organization actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInvitationMock.mockResolvedValue({});
    getEnvSecretsMock.mockReturnValue({
      BETTER_AUTH_ORG_INVITATION_LIMIT: 100,
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      role: MemberRole.ADMIN,
    });
    headersMock.mockResolvedValue(new Headers());
  });

  it("bulk invites parsed emails and preserves first-seen dedupe order", async () => {
    const { inviteOrganizationMembersBulk } = await import("../action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails:
        "first@example.com, second@example.com\nFIRST@example.com; third@example.com",
      session,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          { email: "first@example.com", status: "sent" },
          { email: "second@example.com", status: "sent" },
          { email: "third@example.com", status: "sent" },
        ],
      },
    });
    expect(createInvitationMock).toHaveBeenCalledTimes(3);
    expect(createInvitationMock).toHaveBeenNthCalledWith(1, {
      body: {
        email: "first@example.com",
        organizationId: "org-1",
        resend: true,
        role: MemberRole.MEMBER,
      },
      headers: expect.any(Headers),
    });
  });

  it("returns sent and failed statuses for a partial batch", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    createInvitationMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("invite failed"));
    const { inviteOrganizationMembersBulk } = await import("../action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "ok@example.com, fail@example.com",
      session,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          { email: "ok@example.com", status: "sent" },
          { email: "fail@example.com", status: "failed" },
        ],
      },
    });

    consoleErrorSpy.mockRestore();
  });

  it("rejects users who are not members of the organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);
    const { inviteOrganizationMembersBulk } = await import("../action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "member@example.com",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "You are not a member of this organization",
      },
    });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("rejects members without owner or admin permissions", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      role: MemberRole.MEMBER,
    });
    const { inviteOrganizationMembersBulk } = await import("../action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "member@example.com",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Only organization owners and admins can invite members",
      },
    });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("rejects empty or invalid email input", async () => {
    const { inviteOrganizationMembersBulk } = await import("../action");

    const emptyResult = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "",
      session,
    });
    const invalidResult = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "not-an-email",
      session,
    });

    expect(emptyResult.ok).toBe(false);
    expect(invalidResult).toEqual({
      ok: false,
      error: {
        code: "BAD_INPUT",
        message: "Enter at least one valid email address",
      },
    });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("rejects batches over the invitation limit", async () => {
    getEnvSecretsMock.mockReturnValue({
      BETTER_AUTH_ORG_INVITATION_LIMIT: 1,
    });
    const { inviteOrganizationMembersBulk } = await import("../action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "first@example.com, second@example.com",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "BAD_INPUT",
        message: "You can invite up to 1 members at a time",
      },
    });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });
});

describe("updateOrganizationInvoiceEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncOrganizationInvoiceEmailWithStripeMock.mockResolvedValue(true);
  });

  it("updates the invoice email via Core and syncs with Stripe", async () => {
    updateOrganizationInvoiceEmailMock.mockResolvedValue({
      data: { invoiceEmail: "billing@acme.example" },
    });
    const { updateOrganizationInvoiceEmail } = await import("../action");

    const result = await updateOrganizationInvoiceEmail({
      organizationId: "org-1",
      invoiceEmail: "billing@acme.example",
      session,
    });

    expect(result).toEqual({
      ok: true,
      data: { invoiceEmail: "billing@acme.example" },
    });
    expect(updateOrganizationInvoiceEmailMock).toHaveBeenCalledWith("org-1", {
      invoiceEmail: "billing@acme.example",
    });
    expect(syncOrganizationInvoiceEmailWithStripeMock).toHaveBeenCalledWith(
      "org-1",
      "billing@acme.example",
    );
  });

  it("clears the invoice email when null is provided", async () => {
    updateOrganizationInvoiceEmailMock.mockResolvedValue({
      data: { invoiceEmail: null },
    });
    const { updateOrganizationInvoiceEmail } = await import("../action");

    const result = await updateOrganizationInvoiceEmail({
      organizationId: "org-1",
      invoiceEmail: null,
      session,
    });

    expect(result).toEqual({
      ok: true,
      data: { invoiceEmail: null },
    });
    expect(updateOrganizationInvoiceEmailMock).toHaveBeenCalledWith("org-1", {
      invoiceEmail: null,
    });
    expect(syncOrganizationInvoiceEmailWithStripeMock).toHaveBeenCalledWith(
      "org-1",
      null,
    );
  });

  it("rejects an invalid email without calling Core", async () => {
    const { updateOrganizationInvoiceEmail } = await import("../action");

    const result = await updateOrganizationInvoiceEmail({
      organizationId: "org-1",
      invoiceEmail: "not-an-email",
      session,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BAD_INPUT");
    }
    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
    expect(syncOrganizationInvoiceEmailWithStripeMock).not.toHaveBeenCalled();
  });

  it("maps Core 403 responses to UNAUTHORIZED", async () => {
    updateOrganizationInvoiceEmailMock.mockRejectedValue(
      new MockCoreApiRequestError("You are not a member of this organization", {
        status: 403,
      }),
    );
    const { updateOrganizationInvoiceEmail } = await import("../action");

    const result = await updateOrganizationInvoiceEmail({
      organizationId: "org-1",
      invoiceEmail: "billing@acme.example",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "You are not a member of this organization",
      },
    });
    expect(syncOrganizationInvoiceEmailWithStripeMock).not.toHaveBeenCalled();
  });

  it("maps Core 404 responses to UNAUTHORIZED", async () => {
    updateOrganizationInvoiceEmailMock.mockRejectedValue(
      new MockCoreApiRequestError("Organization not found", { status: 404 }),
    );
    const { updateOrganizationInvoiceEmail } = await import("../action");

    const result = await updateOrganizationInvoiceEmail({
      organizationId: "org-1",
      invoiceEmail: "billing@acme.example",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Organization not found",
      },
    });
    expect(syncOrganizationInvoiceEmailWithStripeMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected Core errors", async () => {
    updateOrganizationInvoiceEmailMock.mockRejectedValue(
      new MockCoreApiRequestError("Internal Server Error", { status: 500 }),
    );
    const { updateOrganizationInvoiceEmail } = await import("../action");

    await expect(
      updateOrganizationInvoiceEmail({
        organizationId: "org-1",
        invoiceEmail: "billing@acme.example",
        session,
      }),
    ).rejects.toThrow("Internal Server Error");
    expect(syncOrganizationInvoiceEmailWithStripeMock).not.toHaveBeenCalled();
  });
});
