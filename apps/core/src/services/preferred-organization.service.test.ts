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
  pickActiveOrganizationId,
  resolveActiveOrganizationIdForSession,
  setPreferredOrganizationId,
} from "./preferred-organization.service";

describe("pickActiveOrganizationId", () => {
  it.each([
    [
      "the preferred organization while a member",
      "org_pref",
      true,
      ["org_1", "org_pref"],
      "org_pref",
    ],
    ["personal when nothing is preferred", null, true, ["org_1"], null],
    ["personal over a stale preference", "org_gone", true, ["org_1"], null],
    [
      "the oldest membership without personal",
      null,
      false,
      ["org_1", "org_2"],
      "org_1",
    ],
    [
      "the oldest membership over a stale preference",
      "org_gone",
      false,
      ["org_2"],
      "org_2",
    ],
    ["null with no workspace at all", null, false, [], null],
  ] as const)(
    "picks %s",
    (_label, preferredOrganizationId, hasPersonalWorkspace, organizationIds, expected) => {
      expect(
        pickActiveOrganizationId({
          preferredOrganizationId,
          hasPersonalWorkspace,
          organizationIds,
        }),
      ).toBe(expected);
    },
  );
});

describe("resolveActiveOrganizationIdForSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads the user, personal workspace and memberships in one round", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      preferredOrganizationId: "org_pref",
    });
    findPersonalWorkspaceMock.mockResolvedValueOnce({ id: "ws_personal" });
    getMembersOrganizationIdsByUserIdMock.mockResolvedValueOnce([
      "org_1",
      "org_pref",
    ]);

    await expect(resolveActiveOrganizationIdForSession("user_1")).resolves.toBe(
      "org_pref",
    );
    expect(getUserByIdMock).toHaveBeenCalledWith("user_1", expect.anything());
    expect(findPersonalWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
    );
    expect(getMembersOrganizationIdsByUserIdMock).toHaveBeenCalledWith(
      "user_1",
      expect.anything(),
    );
  });

  it("falls back to the oldest membership for a stale preference without personal", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      preferredOrganizationId: "org_gone",
    });
    findPersonalWorkspaceMock.mockResolvedValueOnce(null);
    getMembersOrganizationIdsByUserIdMock.mockResolvedValueOnce(["org_2"]);

    await expect(resolveActiveOrganizationIdForSession("user_1")).resolves.toBe(
      "org_2",
    );
  });

  it("keeps personal for a missing user row with a personal workspace", async () => {
    getUserByIdMock.mockResolvedValueOnce(null);
    findPersonalWorkspaceMock.mockResolvedValueOnce({ id: "ws_personal" });
    getMembersOrganizationIdsByUserIdMock.mockResolvedValueOnce(["org_1"]);

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
