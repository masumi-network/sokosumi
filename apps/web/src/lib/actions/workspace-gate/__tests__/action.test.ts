import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode, WorkspaceGateErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.client";

const createMyPersonalWorkspaceMock = vi.fn();
const clearPendingOrganizationJoinTokenMock = vi.fn();

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
    },
  };
});

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    NODE_ENV: "development",
    VERCEL_ENV: undefined,
  }),
}));

vi.mock("@/lib/pending-organization-join-cookie", () => ({
  clearPendingOrganizationJoinToken: (...args: unknown[]) =>
    clearPendingOrganizationJoinTokenMock(...args),
}));

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
});
