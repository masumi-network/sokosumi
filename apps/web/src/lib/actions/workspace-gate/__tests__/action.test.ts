import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode, WorkspaceGateErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.client";

const createMyPersonalWorkspaceMock = vi.fn();
const deleteMyPersonalWorkspaceMock = vi.fn();
const clearPendingOrganizationJoinTokenMock = vi.fn();
const getPendingOrganizationJoinTokenMock = vi.fn();
const resolveOrganizationInviteLinkMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/clients/core.client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/clients/core.client")
  >("@/lib/clients/core.client");
  return {
    ...actual,
    coreClient: {
      createMyPersonalWorkspace: (...args: unknown[]) =>
        createMyPersonalWorkspaceMock(...args),
      deleteMyPersonalWorkspace: (...args: unknown[]) =>
        deleteMyPersonalWorkspaceMock(...args),
      resolveOrganizationInviteLink: (...args: unknown[]) =>
        resolveOrganizationInviteLinkMock(...args),
    },
  };
});

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    NODE_ENV: "development",
    VERCEL_ENV: undefined,
  }),
}));

vi.mock("@/lib/pending-organization-join-cookie", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/pending-organization-join-cookie")
  >("@/lib/pending-organization-join-cookie");
  return {
    ...actual,
    clearPendingOrganizationJoinToken: (...args: unknown[]) =>
      clearPendingOrganizationJoinTokenMock(...args),
    getPendingOrganizationJoinToken: (...args: unknown[]) =>
      getPendingOrganizationJoinTokenMock(...args),
  };
});

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TArgs, TResult>(
      handler: (args: TArgs & { session: unknown }) => Promise<TResult>,
    ) =>
    async (args: TArgs) =>
      handler({ ...args, session: { user: { id: "user_1" } } }),
}));

import {
  clearPendingOrganizationJoinCookieAction,
  createPersonalWorkspaceAction,
  deletePersonalWorkspaceAction,
} from "@/lib/actions/workspace-gate/action";

describe("createPersonalWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspaceId on success", async () => {
    createMyPersonalWorkspaceMock.mockResolvedValue({
      data: { workspaceId: "ws-1" },
    });

    const result = await createPersonalWorkspaceAction({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ workspaceId: "ws-1" });
    }
    expect(createMyPersonalWorkspaceMock).toHaveBeenCalledOnce();
  });

  it("maps Core 409 to PERSONAL_WORKSPACE_ALREADY_EXISTS", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    createMyPersonalWorkspaceMock.mockRejectedValue(
      new CoreApiRequestError("Personal workspace already exists", {
        status: 409,
      }),
    );

    try {
      const result = await createPersonalWorkspaceAction({});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS,
          message: "Personal workspace already exists",
        });
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("maps unexpected Core failures to INTERNAL_SERVER_ERROR", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    createMyPersonalWorkspaceMock.mockRejectedValue(
      new CoreApiRequestError("Core backend timeout", { status: 503 }),
    );

    try {
      const result = await createPersonalWorkspaceAction({});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("deletePersonalWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspaceId on success", async () => {
    deleteMyPersonalWorkspaceMock.mockResolvedValue({
      data: { workspaceId: "ws-1" },
    });

    const result = await deletePersonalWorkspaceAction({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ workspaceId: "ws-1" });
    }
    expect(deleteMyPersonalWorkspaceMock).toHaveBeenCalledOnce();
  });

  it("maps Core last-workspace 409", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    deleteMyPersonalWorkspaceMock.mockRejectedValue(
      new CoreApiRequestError("Cannot delete the user's last workspace", {
        status: 409,
        kind: "last_workspace",
      }),
    );

    try {
      const result = await deletePersonalWorkspaceAction({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(WorkspaceGateErrorCode.LAST_WORKSPACE);
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("maps Core dependents 409", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    deleteMyPersonalWorkspaceMock.mockRejectedValue(
      new CoreApiRequestError(
        "Cannot delete a personal workspace that still has jobs or tasks",
        {
          status: 409,
          kind: "workspace_has_dependents",
        },
      ),
    );

    try {
      const result = await deletePersonalWorkspaceAction({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(
          WorkspaceGateErrorCode.WORKSPACE_HAS_DEPENDENTS,
        );
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not treat an unclassified 409 as last workspace", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    deleteMyPersonalWorkspaceMock.mockRejectedValue(
      new CoreApiRequestError("Conflict", { status: 409 }),
    );

    try {
      const result = await deletePersonalWorkspaceAction({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
        expect(result.error.code).not.toBe(
          WorkspaceGateErrorCode.LAST_WORKSPACE,
        );
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("clearPendingOrganizationJoinCookieAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the recovered join token", async () => {
    const result = await clearPendingOrganizationJoinCookieAction({});
    expect(result.ok).toBe(true);
    expect(clearPendingOrganizationJoinTokenMock).toHaveBeenCalledWith({
      secure: false,
    });
  });

  it("clears the cookie when it is the accepted join token", async () => {
    getPendingOrganizationJoinTokenMock.mockResolvedValue("tok_1");

    const result = await clearPendingOrganizationJoinCookieAction({
      organizationSlug: "acme",
      acceptedJoinToken: "tok_1",
    });

    expect(result.ok).toBe(true);
    expect(clearPendingOrganizationJoinTokenMock).toHaveBeenCalledWith({
      secure: false,
    });
  });

  it("keeps the cookie when it points at a different org", async () => {
    getPendingOrganizationJoinTokenMock.mockResolvedValue("tok_other");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: {
        status: "valid",
        organization: { name: "Other", slug: "other-co", logo: null },
      },
    });

    const result = await clearPendingOrganizationJoinCookieAction({
      organizationSlug: "acme",
    });

    expect(result.ok).toBe(true);
    expect(clearPendingOrganizationJoinTokenMock).not.toHaveBeenCalled();
  });

  it("clears the cookie when a different token resolves to the accepted org", async () => {
    getPendingOrganizationJoinTokenMock.mockResolvedValue("tok_other");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: {
        status: "valid",
        organization: { name: "Acme", slug: "acme", logo: null },
      },
    });

    const result = await clearPendingOrganizationJoinCookieAction({
      organizationSlug: "acme",
    });

    expect(result.ok).toBe(true);
    expect(resolveOrganizationInviteLinkMock).toHaveBeenCalledWith("tok_other");
    expect(clearPendingOrganizationJoinTokenMock).toHaveBeenCalledWith({
      secure: false,
    });
  });

  it("keeps the cookie when invite-link resolution fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getPendingOrganizationJoinTokenMock.mockResolvedValue("tok_other");
    resolveOrganizationInviteLinkMock.mockRejectedValue(
      new Error("Core backend timeout"),
    );

    try {
      const result = await clearPendingOrganizationJoinCookieAction({
        organizationSlug: "acme",
      });

      expect(result.ok).toBe(true);
      expect(resolveOrganizationInviteLinkMock).toHaveBeenCalledWith(
        "tok_other",
      );
      expect(clearPendingOrganizationJoinTokenMock).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
