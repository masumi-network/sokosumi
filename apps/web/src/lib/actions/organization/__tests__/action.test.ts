import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const createInvitationMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const inviteMultipleMembersMock = vi.fn();
const headersMock = vi.fn();

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

vi.mock("@/lib/services/organization.service", () => ({
  organizationService: {
    inviteMultipleMembers: (...args: unknown[]) =>
      inviteMultipleMembersMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("@/lib/services/preferred-organization.service", () => ({
  preferredOrganizationService: {},
}));

vi.mock("@/lib/services/stripe.service", () => ({
  stripeService: {},
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
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.ADMIN,
    });
    inviteMultipleMembersMock.mockImplementation(
      async (_organizationId: string, emails: string[]) => ({
        results: emails.map((email) => ({ email, status: "sent" as const })),
      }),
    );
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
    expect(inviteMultipleMembersMock).toHaveBeenCalledWith(
      "org-1",
      ["first@example.com", "second@example.com", "third@example.com"],
      MemberRole.MEMBER,
    );
  });

  it("returns sent and failed statuses for a partial batch", async () => {
    inviteMultipleMembersMock.mockResolvedValueOnce({
      results: [
        { email: "ok@example.com", status: "sent" },
        { email: "fail@example.com", status: "failed" },
      ],
    });
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
    expect(inviteMultipleMembersMock).not.toHaveBeenCalled();
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
    expect(inviteMultipleMembersMock).not.toHaveBeenCalled();
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
    expect(inviteMultipleMembersMock).not.toHaveBeenCalled();
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
    expect(inviteMultipleMembersMock).not.toHaveBeenCalled();
  });
});
