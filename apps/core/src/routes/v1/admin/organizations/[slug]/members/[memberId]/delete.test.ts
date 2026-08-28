import { OrganizationOwnerRetentionError } from "@sokosumi/database/helpers";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountRemoveAdminOrganizationMember from "./delete";

const {
  getAdminOrganizationBySlugMock,
  getMemberByIdAndOrganizationIdMock,
  removeMemberMock,
  applyOrganizationExitChatRevocationMock,
  publishOrganizationExitChatRevocationMock,
  transactionMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  getAdminOrganizationBySlugMock: vi.fn(),
  getMemberByIdAndOrganizationIdMock: vi.fn(),
  removeMemberMock: vi.fn(),
  applyOrganizationExitChatRevocationMock: vi.fn(),
  publishOrganizationExitChatRevocationMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
  },
}));

vi.mock("@/helpers/admin-organization-overview.js", () => ({
  getAdminOrganizationBySlug: (...args: unknown[]) =>
    getAdminOrganizationBySlugMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByIdAndOrganizationIdMock(...args),
    removeMember: (...args: unknown[]) => removeMemberMock(...args),
  },
}));

vi.mock("@/helpers/chat-room-organization-exit", () => ({
  applyOrganizationExitChatRevocation: (...args: unknown[]) =>
    applyOrganizationExitChatRevocationMock(...args),
  publishOrganizationExitChatRevocation: (...args: unknown[]) =>
    publishOrganizationExitChatRevocationMock(...args),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountRemoveAdminOrganizationMember(app);

  return app;
}

const ORG = { id: "org_1", slug: "acme" };
const MEMBER = {
  id: "mem_1",
  userId: "user_target",
  organizationId: "org_1",
};

describe("DELETE /admin/organizations/{slug}/members/{memberId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminOrganizationBySlugMock.mockResolvedValue(ORG);
    getMemberByIdAndOrganizationIdMock.mockResolvedValue(MEMBER);
    removeMemberMock.mockResolvedValue(undefined);
    applyOrganizationExitChatRevocationMock.mockResolvedValue({
      revokedRoomIds: ["room-1"],
      statusMessages: [],
    });
    publishOrganizationExitChatRevocationMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback) => callback({}));
  });

  it("hard-leaves chat rooms before removing the member, then publishes", async () => {
    const callOrder: string[] = [];
    applyOrganizationExitChatRevocationMock.mockImplementation(async () => {
      callOrder.push("apply");
      return { revokedRoomIds: ["room-1"], statusMessages: [] };
    });
    removeMemberMock.mockImplementation(async () => {
      callOrder.push("removeMember");
    });
    publishOrganizationExitChatRevocationMock.mockImplementation(async () => {
      callOrder.push("publish");
    });

    const app = createApp();
    const response = await app.request("http://localhost/acme/members/mem_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(applyOrganizationExitChatRevocationMock).toHaveBeenCalledWith(
      {},
      "user_target",
      "org_1",
    );
    expect(removeMemberMock).toHaveBeenCalledWith("mem_1", "org_1", {});
    expect(publishOrganizationExitChatRevocationMock).toHaveBeenCalledWith(
      "user_target",
      { revokedRoomIds: ["room-1"], statusMessages: [] },
    );
    expect(callOrder).toEqual(["apply", "removeMember", "publish"]);
  });

  it("does not publish when owner retention blocks remove", async () => {
    removeMemberMock.mockRejectedValue(new OrganizationOwnerRetentionError());

    const app = createApp();
    const response = await app.request("http://localhost/acme/members/mem_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(publishOrganizationExitChatRevocationMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization is missing", async () => {
    getAdminOrganizationBySlugMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(
      "http://localhost/missing/members/mem_1",
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
