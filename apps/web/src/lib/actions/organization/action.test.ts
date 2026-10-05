import { MemberRole } from "@sokosumi/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const inviteOrganizationMemberViaCoreMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const headersMock = vi.fn();
const getMyWorkspacesMock = vi.fn();
const setMyPreferredWorkspaceMock = vi.fn();
const createMyWorkspaceMock = vi.fn();

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
    createMyWorkspace: (...args: unknown[]) => createMyWorkspaceMock(...args),
    getMyWorkspaces: (...args: unknown[]) => getMyWorkspacesMock(...args),
    setMyPreferredWorkspace: (...args: unknown[]) =>
      setMyPreferredWorkspaceMock(...args),
  },
}));

const readRouteSessionMock = vi.fn();

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: () => readRouteSessionMock(),
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

const invalidatePrivateSidebarChromeMock = vi.fn();

vi.mock("@/app/components/private-sidebar-cache", () => ({
  invalidatePrivateSidebarChrome: (...args: unknown[]) =>
    invalidatePrivateSidebarChromeMock(...args),
}));

const session = {
  user: {
    id: "user-1",
  },
  session: {
    activeOrganizationId: "org-prev",
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
    const { inviteOrganizationMembersBulk } = await import("./action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails:
        "first@example.com, second@example.com\nFIRST@example.com; third@example.com",
      session,
    });

    expect(result).toEqual({
      ok: true,
      value: {
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
    const { inviteOrganizationMembersBulk } = await import("./action");

    const result = await inviteOrganizationMembersBulk({
      organizationId: "org-1",
      rawEmails: "ok@example.com, fail@example.com",
      session,
    });

    expect(result).toEqual({
      ok: true,
      value: {
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
    const { inviteOrganizationMembersBulk } = await import("./action");

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
    const { inviteOrganizationMembersBulk } = await import("./action");

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
    const { inviteOrganizationMembersBulk } = await import("./action");

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
    const { inviteOrganizationMembersBulk } = await import("./action");

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
    const { inviteOrganizationMembersBulk } = await import("./action");

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

const WORKSPACES = {
  data: {
    workspaces: [
      { id: "ws-personal", kind: "personal", organizationId: null },
      { id: "ws-org-1", kind: "organization", organizationId: "org-1" },
    ],
    pendingInvitationCount: 0,
  },
};

describe("updatePreferredOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyWorkspacesMock.mockResolvedValue(WORKSPACES);
  });

  it("prefers the organization's workspace via Core", async () => {
    setMyPreferredWorkspaceMock.mockResolvedValue({
      data: { id: "ws-org-1", organizationId: "org-1" },
    });
    const { updatePreferredOrganization } = await import("./action");

    const result = await updatePreferredOrganization({
      organizationId: "org-1",
      session,
    });

    expect(result).toEqual({
      ok: true,
      value: { organizationId: "org-1" },
    });
    expect(setMyPreferredWorkspaceMock).toHaveBeenCalledWith("ws-org-1");
    expect(invalidatePrivateSidebarChromeMock).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      previousOrganizationId: "org-prev",
    });
  });

  it("prefers the personal workspace when null is provided", async () => {
    setMyPreferredWorkspaceMock.mockResolvedValue({
      data: { id: "ws-personal", organizationId: null },
    });
    const { updatePreferredOrganization } = await import("./action");

    const result = await updatePreferredOrganization({
      organizationId: null,
      session,
    });

    expect(result).toEqual({
      ok: true,
      value: { organizationId: null },
    });
    expect(setMyPreferredWorkspaceMock).toHaveBeenCalledWith("ws-personal");
  });

  it("refuses an organization the person is not a member of", async () => {
    const { updatePreferredOrganization } = await import("./action");

    const result = await updatePreferredOrganization({
      organizationId: "org-other",
      session,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "You are not a member of this organization",
      },
    });
    expect(setMyPreferredWorkspaceMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the membership ended",
      new MockCoreApiRequestError("Membership check failed", {
        kind: "organization_membership_required",
        status: 403,
      }),
    ],
    [
      "the organization is gone",
      new MockCoreApiRequestError("Workspace not found", { status: 404 }),
    ],
  ])("refuses when %s before Core saved it", async (_label, failure) => {
    setMyPreferredWorkspaceMock.mockRejectedValue(failure);
    const { updatePreferredOrganization } = await import("./action");

    const result = await updatePreferredOrganization({
      organizationId: "org-1",
      session,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("says the personal workspace is gone when Core no longer finds it", async () => {
    setMyPreferredWorkspaceMock.mockRejectedValue(
      new MockCoreApiRequestError("Workspace not found", { status: 404 }),
    );
    const { updatePreferredOrganization } = await import("./action");

    const result = await updatePreferredOrganization({
      organizationId: null,
      session,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("says when there is no personal workspace to prefer", async () => {
    getMyWorkspacesMock.mockResolvedValue({
      data: {
        workspaces: [
          { id: "ws-org-1", kind: "organization", organizationId: "org-1" },
        ],
        pendingInvitationCount: 0,
      },
    });
    const { updatePreferredOrganization } = await import("./action");

    const result = await updatePreferredOrganization({
      organizationId: null,
      session,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(setMyPreferredWorkspaceMock).not.toHaveBeenCalled();
  });

  it("rethrows unexpected Core errors", async () => {
    setMyPreferredWorkspaceMock.mockRejectedValue(
      new MockCoreApiRequestError("Internal Server Error", { status: 500 }),
    );
    const { updatePreferredOrganization } = await import("./action");

    await expect(
      updatePreferredOrganization({
        organizationId: "org-1",
        session,
      }),
    ).rejects.toThrow("Internal Server Error");
  });
});

describe("createOrganizationWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session,
    });
  });

  it("returns UNAUTHENTICATED for a signed-out person without asking Core", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });
    const { createOrganizationWorkspaceAction } = await import("./action");

    const result = await createOrganizationWorkspaceAction({
      name: "Acme",
      websiteUrl: "https://acme.com",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(createMyWorkspaceMock).not.toHaveBeenCalled();
  });

  it("creates the organization through Core's workspaces resource", async () => {
    createMyWorkspaceMock.mockResolvedValue({
      data: { id: "ws-org-1", kind: "organization", organizationId: "org-1" },
    });
    const { createOrganizationWorkspaceAction } = await import("./action");

    const result = await createOrganizationWorkspaceAction({
      name: "Acme",
      websiteUrl: "https://acme.com",
    });

    expect(result).toEqual({ ok: true, value: { organizationId: "org-1" } });
    expect(createMyWorkspaceMock).toHaveBeenCalledWith({
      kind: "organization",
      name: "Acme",
      websiteUrl: "https://acme.com",
    });
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "ORGANIZATION_LIMIT_REACHED"],
    [400, "BAD_INPUT"],
    [422, "BAD_INPUT"],
  ])("maps Core %i to %s with Core's message", async (status, code) => {
    createMyWorkspaceMock.mockRejectedValue(
      new MockCoreApiRequestError("Core refused", { status }),
    );
    const { createOrganizationWorkspaceAction } = await import("./action");

    const result = await createOrganizationWorkspaceAction({
      name: "Acme",
      websiteUrl: "https://acme.com",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code, message: "Core refused" },
    });
  });

  it.each(["A", "A".repeat(51)])(
    "rejects a name Core would refuse (%s) without asking Core",
    async (name) => {
      const { createOrganizationWorkspaceAction } = await import("./action");

      const result = await createOrganizationWorkspaceAction({
        name,
        websiteUrl: "https://acme.com",
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "BAD_INPUT" },
      });
      expect(createMyWorkspaceMock).not.toHaveBeenCalled();
    },
  );

  it.each(["", "not a website"])(
    "rejects a website Core would refuse (%j) without asking Core",
    async (websiteUrl) => {
      const { createOrganizationWorkspaceAction } = await import("./action");

      const result = await createOrganizationWorkspaceAction({
        name: "Acme",
        websiteUrl,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "BAD_INPUT" },
      });
      expect(createMyWorkspaceMock).not.toHaveBeenCalled();
    },
  );

  it("maps other failures to INTERNAL_SERVER_ERROR", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    createMyWorkspaceMock.mockRejectedValue(new Error("fetch failed"));
    const { createOrganizationWorkspaceAction } = await import("./action");

    try {
      const result = await createOrganizationWorkspaceAction({
        name: "Acme",
        websiteUrl: "https://acme.com",
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR" },
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
