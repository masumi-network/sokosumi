import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRole } from "@/lib/clients/generated/core";

vi.mock("server-only", () => ({}));

export {};

const inviteOrganizationMemberViaCoreMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const headersMock = vi.fn();
const setMyPreferredOrganizationMock = vi.fn();

class MockCoreApiRequestError extends Error {
  kind?: string;
  status?: number;

  constructor(message: string, options?: { kind?: string; status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.kind = options?.kind;
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    setMyPreferredOrganization: (...args: unknown[]) =>
      setMyPreferredOrganizationMock(...args),
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

vi.mock("@/lib/auth/core-auth-http.server", () => ({
  inviteOrganizationMemberViaCore: (...args: unknown[]) =>
    inviteOrganizationMemberViaCoreMock(...args),
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

const session = {
  user: {
    id: "user-1",
  },
} as never;

describe("organization actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inviteOrganizationMemberViaCoreMock.mockResolvedValue(undefined);
    getEnvSecretsMock.mockReturnValue({
      ORG_INVITATION_LIMIT: 100,
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
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
    expect(getMyMemberInOrganizationMock).toHaveBeenCalledWith("org-1");
    expect(inviteOrganizationMemberViaCoreMock).toHaveBeenCalledTimes(3);
    expect(inviteOrganizationMemberViaCoreMock).toHaveBeenNthCalledWith(1, {
      email: "first@example.com",
      organizationId: "org-1",
      resend: true,
      role: MemberRole.MEMBER,
    });
  });

  it("returns sent and failed statuses for a partial batch", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    inviteOrganizationMemberViaCoreMock
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
    getMyMemberInOrganizationMock.mockResolvedValue(null);
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
    expect(inviteOrganizationMemberViaCoreMock).not.toHaveBeenCalled();
  });

  it("rejects members without owner or admin permissions", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
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
    expect(inviteOrganizationMemberViaCoreMock).not.toHaveBeenCalled();
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
    expect(getMyMemberInOrganizationMock).not.toHaveBeenCalled();
    expect(inviteOrganizationMemberViaCoreMock).not.toHaveBeenCalled();
  });

  it("rejects batches over the invitation limit", async () => {
    getEnvSecretsMock.mockReturnValue({
      ORG_INVITATION_LIMIT: 1,
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
    expect(getMyMemberInOrganizationMock).not.toHaveBeenCalled();
    expect(inviteOrganizationMemberViaCoreMock).not.toHaveBeenCalled();
  });

  it("maps membership lookup failures to INTERNAL_SERVER_ERROR", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getMyMemberInOrganizationMock.mockRejectedValue(
      new MockCoreApiRequestError("Internal Server Error", { status: 500 }),
    );
    const { inviteOrganizationMembersBulk } = await import("../action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "member@example.com",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
      },
    });
    expect(inviteOrganizationMemberViaCoreMock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe("updatePreferredOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the preferred organization via Core", async () => {
    setMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: "org-1" },
    });
    const { updatePreferredOrganization } = await import("../action");

    const result = await updatePreferredOrganization({
      organizationId: "org-1",
      session,
    });

    expect(result).toEqual({
      ok: true,
      data: { organizationId: "org-1" },
    });
    expect(setMyPreferredOrganizationMock).toHaveBeenCalledWith("org-1");
  });

  it("clears the preferred organization when null is provided", async () => {
    setMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: null },
    });
    const { updatePreferredOrganization } = await import("../action");

    const result = await updatePreferredOrganization({
      organizationId: null,
      session,
    });

    expect(result).toEqual({
      ok: true,
      data: { organizationId: null },
    });
    expect(setMyPreferredOrganizationMock).toHaveBeenCalledWith(null);
  });

  it("maps the organization_membership_required kind to UNAUTHORIZED", async () => {
    setMyPreferredOrganizationMock.mockRejectedValue(
      new MockCoreApiRequestError("Membership check failed", {
        kind: "organization_membership_required",
        status: 403,
      }),
    );
    const { updatePreferredOrganization } = await import("../action");

    const result = await updatePreferredOrganization({
      organizationId: "org-1",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "You are not a member of this organization",
      },
    });
  });

  it("rethrows unexpected Core errors", async () => {
    setMyPreferredOrganizationMock.mockRejectedValue(
      new MockCoreApiRequestError("Internal Server Error", { status: 500 }),
    );
    const { updatePreferredOrganization } = await import("../action");

    await expect(
      updatePreferredOrganization({
        organizationId: "org-1",
        session,
      }),
    ).rejects.toThrow("Internal Server Error");
  });
});
