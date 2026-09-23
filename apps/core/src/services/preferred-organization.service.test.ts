import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserByIdMock = vi.fn();
const updatePreferredOrganizationIdMock = vi.fn();
const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const getMembersOrganizationIdsByUserIdMock = vi.fn();
const findPersonalWorkspaceMock = vi.fn();
const workspaceFindUniqueMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
    updatePreferredOrganizationId: (...args: unknown[]) =>
      updatePreferredOrganizationIdMock(...args),
  },
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
    getMembersOrganizationIdsByUserId: (...args: unknown[]) =>
      getMembersOrganizationIdsByUserIdMock(...args),
  },
  workspaceRepository: {
    findPersonalWorkspace: (...args: unknown[]) =>
      findPersonalWorkspaceMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    workspace: {
      findUnique: (...args: unknown[]) => workspaceFindUniqueMock(...args),
    },
  },
}));

import {
  resolveActiveOrganizationIdForSession,
  setPreferredOrganizationId,
} from "./preferred-organization.service";

describe("resolveActiveOrganizationIdForSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the preferred organization when the user is still a member", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      preferredOrganizationId: "org_pref",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({
      organizationId: "org_pref",
    });

    await expect(resolveActiveOrganizationIdForSession("user_1")).resolves.toBe(
      "org_pref",
    );
    expect(findPersonalWorkspaceMock).not.toHaveBeenCalled();
    expect(getMembersOrganizationIdsByUserIdMock).not.toHaveBeenCalled();
  });

  it("keeps personal when preferred is null and a personal workspace exists", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      preferredOrganizationId: null,
    });
    findPersonalWorkspaceMock.mockResolvedValueOnce({ id: "ws_personal" });

    await expect(
      resolveActiveOrganizationIdForSession("user_1"),
    ).resolves.toBeNull();
    expect(getMembersOrganizationIdsByUserIdMock).not.toHaveBeenCalled();
  });

  it("falls back to a remaining org when preferred is null and personal is missing", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      preferredOrganizationId: null,
    });
    findPersonalWorkspaceMock.mockResolvedValueOnce(null);
    getMembersOrganizationIdsByUserIdMock.mockResolvedValueOnce(["org_1"]);

    await expect(resolveActiveOrganizationIdForSession("user_1")).resolves.toBe(
      "org_1",
    );
  });

  it("falls back to a remaining org when preferred is stale and personal is missing", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      preferredOrganizationId: "org_gone",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);
    findPersonalWorkspaceMock.mockResolvedValueOnce(null);
    getMembersOrganizationIdsByUserIdMock.mockResolvedValueOnce(["org_2"]);

    await expect(resolveActiveOrganizationIdForSession("user_1")).resolves.toBe(
      "org_2",
    );
  });

  it("keeps personal when preferred is stale and a personal workspace exists", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      preferredOrganizationId: "org_gone",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);
    findPersonalWorkspaceMock.mockResolvedValueOnce({ id: "ws_personal" });

    await expect(
      resolveActiveOrganizationIdForSession("user_1"),
    ).resolves.toBeNull();
    expect(getMembersOrganizationIdsByUserIdMock).not.toHaveBeenCalled();
  });
  it("returns null when setup is required and no workspace exists", async () => {
    getUserByIdMock.mockResolvedValueOnce({ preferredOrganizationId: null });
    findPersonalWorkspaceMock.mockResolvedValueOnce(null);
    getMembersOrganizationIdsByUserIdMock.mockResolvedValueOnce([]);

    await expect(
      resolveActiveOrganizationIdForSession("user_1"),
    ).resolves.toBeNull();
  });
});

describe("setPreferredOrganizationId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    transactionMock.mockImplementation(async (callback) => {
      return await callback("tx");
    });
  });

  it("clears the preferred organization without a membership check", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: "ws_personal" });
    updatePreferredOrganizationIdMock.mockResolvedValue(undefined);

    await setPreferredOrganizationId("user_1", null);

    expect(updatePreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user_1",
      null,
      expect.anything(),
    );
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("throws 404 when switching to personal without a personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);

    await expect(
      setPreferredOrganizationId("user_1", null),
    ).rejects.toMatchObject({
      status: 404,
      cause: { kind: "personal_workspace_missing" },
    });
    expect(updatePreferredOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("throws 403 with a membership kind when the user is not a member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);

    await expect(
      setPreferredOrganizationId("user_1", "org_1"),
    ).rejects.toMatchObject({
      status: 403,
      cause: { kind: "organization_membership_required" },
    });
    expect(updatePreferredOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("persists the preferred organization inside the membership transaction", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member_1",
      role: "member",
    });
    updatePreferredOrganizationIdMock.mockResolvedValue(undefined);

    await setPreferredOrganizationId("user_1", "org_1");

    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      "tx",
    );
    expect(updatePreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      "tx",
    );
  });
});
