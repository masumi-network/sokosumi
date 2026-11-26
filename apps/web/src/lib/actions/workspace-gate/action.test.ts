import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors/error-codes/workspace-gate";
import { CoreApiRequestError } from "@/lib/clients/core.client";

const createMyWorkspaceMock = vi.fn();
const deleteMyWorkspaceMock = vi.fn();
const getMyWorkspacesMock = vi.fn();
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
      createMyWorkspace: (...args: unknown[]) => createMyWorkspaceMock(...args),
      deleteMyWorkspace: (...args: unknown[]) => deleteMyWorkspaceMock(...args),
      getMyWorkspaces: (...args: unknown[]) => getMyWorkspacesMock(...args),
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

import { expectConsole } from "@sokosumi/utils/test-console";
import {
  clearPendingOrganizationJoinCookieAction,
  createPersonalWorkspaceAction,
  deletePersonalWorkspaceAction,
  ensureOAuthWorkspaceAction,
} from "@/lib/actions/workspace-gate/action";

describe("ensureOAuthWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a personal workspace when the user has no workspace", async () => {
    getMyWorkspacesMock.mockResolvedValue({
      data: { workspaces: [], pendingInvitationCount: 0 },
    });
    createMyWorkspaceMock.mockResolvedValue({
      data: { id: "ws-1", kind: "personal" },
    });

    const result = await ensureOAuthWorkspaceAction({});

    expect(result).toEqual({
      ok: true,
      value: { createdPersonalWorkspace: true },
    });
    expect(createMyWorkspaceMock).toHaveBeenCalledExactlyOnceWith({
      kind: "personal",
    });
  });

  it.each(["personal", "organization"])(
    "does not create when a %s workspace already exists",
    async (kind) => {
      getMyWorkspacesMock.mockResolvedValue({
        data: { workspaces: [{ id: "ws-1", kind }], pendingInvitationCount: 0 },
      });

      const result = await ensureOAuthWorkspaceAction({});

      expect(result).toEqual({
        ok: true,
        value: { createdPersonalWorkspace: false },
      });
      expect(createMyWorkspaceMock).not.toHaveBeenCalled();
    },
  );

  it("treats a concurrent personal-workspace create as success", async () => {
    getMyWorkspacesMock.mockResolvedValue({
      data: { workspaces: [], pendingInvitationCount: 0 },
    });
    createMyWorkspaceMock.mockRejectedValue(
      new CoreApiRequestError("Personal workspace already exists", {
        status: 409,
      }),
    );

    const result = await ensureOAuthWorkspaceAction({});

    expect(result).toEqual({
      ok: true,
      value: { createdPersonalWorkspace: false },
    });
  });

  it("returns an error when workspace access cannot be checked", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to prepare workspace for OAuth",
    );
    const error = new CoreApiRequestError("Core backend timeout", {
      status: 503,
    });
    getMyWorkspacesMock.mockRejectedValue(error);

    try {
      const result = await ensureOAuthWorkspaceAction({});

      expect(errorCalls[0]?.[1]).toBe(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      }
      expect(createMyWorkspaceMock).not.toHaveBeenCalled();
    } finally {
    }
  });
});

describe("createPersonalWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns workspaceId on success", async () => {
    createMyWorkspaceMock.mockResolvedValue({
      data: { id: "ws-1", kind: "personal" },
    });

    const result = await createPersonalWorkspaceAction({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ workspaceId: "ws-1" });
    }
    expect(createMyWorkspaceMock).toHaveBeenCalledExactlyOnceWith({
      kind: "personal",
    });
  });

  it("maps Core 409 to PERSONAL_WORKSPACE_ALREADY_EXISTS", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to create personal workspace",
    );
    const error = new CoreApiRequestError("Personal workspace already exists", {
      status: 409,
    });
    createMyWorkspaceMock.mockRejectedValue(error);

    try {
      const result = await createPersonalWorkspaceAction({});

      expect(errorCalls[0]?.[1]).toBe(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS,
          message: "Personal workspace already exists",
        });
      }
    } finally {
    }
  });

  it("maps unexpected Core failures to INTERNAL_SERVER_ERROR", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to create personal workspace",
    );
    const error = new CoreApiRequestError("Core backend timeout", {
      status: 503,
    });
    createMyWorkspaceMock.mockRejectedValue(error);

    try {
      const result = await createPersonalWorkspaceAction({});

      expect(errorCalls[0]?.[1]).toBe(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      }
    } finally {
    }
  });
});

describe("deletePersonalWorkspaceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyWorkspacesMock.mockResolvedValue({
      data: {
        workspaces: [
          { id: "ws-org", kind: "organization", organizationId: "org-1" },
          { id: "ws-1", kind: "personal", organizationId: null },
        ],
        pendingInvitationCount: 0,
      },
    });
  });

  it("deletes the personal workspace by its id from the list", async () => {
    deleteMyWorkspaceMock.mockResolvedValue({
      data: { workspaceId: "ws-1" },
    });

    const result = await deletePersonalWorkspaceAction({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ workspaceId: "ws-1" });
    }
    expect(deleteMyWorkspaceMock).toHaveBeenCalledExactlyOnceWith("ws-1");
  });

  it("returns NOT_FOUND without asking Core when there is no personal workspace", async () => {
    getMyWorkspacesMock.mockResolvedValue({
      data: {
        workspaces: [
          { id: "ws-org", kind: "organization", organizationId: "org-1" },
        ],
        pendingInvitationCount: 0,
      },
    });

    const result = await deletePersonalWorkspaceAction({});

    expect(result).toMatchObject({
      ok: false,
      error: { code: CommonErrorCode.NOT_FOUND },
    });
    expect(deleteMyWorkspaceMock).not.toHaveBeenCalled();
  });

  it("maps Core last-workspace 409", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to delete personal workspace",
    );
    const error = new CoreApiRequestError(
      "Cannot delete the user's last workspace",
      {
        status: 409,
        kind: "last_workspace",
      },
    );
    deleteMyWorkspaceMock.mockRejectedValue(error);

    try {
      const result = await deletePersonalWorkspaceAction({});
      expect(errorCalls[0]?.[1]).toBe(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(WorkspaceGateErrorCode.LAST_WORKSPACE);
      }
    } finally {
    }
  });

  it("maps Core dependents 409", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to delete personal workspace",
    );
    const error = new CoreApiRequestError(
      "Cannot delete a personal workspace that still has jobs or tasks",
      {
        status: 409,
        kind: "workspace_has_dependents",
      },
    );
    deleteMyWorkspaceMock.mockRejectedValue(error);

    try {
      const result = await deletePersonalWorkspaceAction({});
      expect(errorCalls[0]?.[1]).toBe(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(
          WorkspaceGateErrorCode.WORKSPACE_HAS_DEPENDENTS,
        );
      }
    } finally {
    }
  });

  it("does not treat an unclassified 409 as last workspace", async () => {
    const errorCalls = expectConsole(
      "error",
      "Failed to delete personal workspace",
    );
    const error = new CoreApiRequestError("Conflict", { status: 409 });
    deleteMyWorkspaceMock.mockRejectedValue(error);

    try {
      const result = await deletePersonalWorkspaceAction({});
      expect(errorCalls[0]?.[1]).toBe(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
        expect(result.error.code).not.toBe(
          WorkspaceGateErrorCode.LAST_WORKSPACE,
        );
      }
    } finally {
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
    expectConsole(
      "error",
      "Failed to resolve pending organization join token for cookie clear",
    );
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
    }
  });
});
