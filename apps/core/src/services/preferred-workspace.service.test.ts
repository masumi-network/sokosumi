import { membershipAgeOrderBy } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const workspaceFindUniqueMock = vi.fn();
const memberFindManyMock = vi.fn();
const memberFindUniqueMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) => workspaceFindUniqueMock(...args),
    },
    member: {
      findMany: (...args: unknown[]) => memberFindManyMock(...args),
      findUnique: (...args: unknown[]) => memberFindUniqueMock(...args),
    },
  },
}));

import {
  pickActiveOrganizationId,
  resolveActiveOrganizationIdForSession,
  setPreferredOrganizationId,
  setPreferredWorkspace,
} from "./preferred-workspace.service";

const tx = {
  member: { findUnique: memberFindUniqueMock },
  user: { update: userUpdateMock },
};

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
    userFindUniqueMock.mockResolvedValueOnce({
      preferredOrganizationId: "org_pref",
    });
    workspaceFindUniqueMock.mockResolvedValueOnce({ id: "ws_personal" });
    memberFindManyMock.mockResolvedValueOnce([
      { organizationId: "org_1" },
      { organizationId: "org_pref" },
    ]);

    await expect(resolveActiveOrganizationIdForSession("user_1")).resolves.toBe(
      "org_pref",
    );
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      select: { preferredOrganizationId: true },
    });
    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { id: true },
    });
    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      orderBy: [...membershipAgeOrderBy],
      select: { organizationId: true },
    });
  });

  it("falls back to the oldest membership for a stale preference without personal", async () => {
    userFindUniqueMock.mockResolvedValueOnce({
      preferredOrganizationId: "org_gone",
    });
    workspaceFindUniqueMock.mockResolvedValueOnce(null);
    memberFindManyMock.mockResolvedValueOnce([{ organizationId: "org_2" }]);

    await expect(resolveActiveOrganizationIdForSession("user_1")).resolves.toBe(
      "org_2",
    );
  });

  it("keeps personal for a missing user row with a personal workspace", async () => {
    userFindUniqueMock.mockResolvedValueOnce(null);
    workspaceFindUniqueMock.mockResolvedValueOnce({ id: "ws_personal" });
    memberFindManyMock.mockResolvedValueOnce([{ organizationId: "org_1" }]);

    await expect(
      resolveActiveOrganizationIdForSession("user_1"),
    ).resolves.toBeNull();
  });
});

describe("setPreferredOrganizationId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    transactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });
  });

  it("clears the preferred organization without a membership check", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: "ws_personal" });
    userUpdateMock.mockResolvedValue(undefined);

    await setPreferredOrganizationId("user_1", null);

    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { preferredOrganizationId: null },
    });
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
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
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("throws 403 with a membership kind when the user is not a member", async () => {
    memberFindUniqueMock.mockResolvedValue(null);

    await expect(
      setPreferredOrganizationId("user_1", "org_1"),
    ).rejects.toMatchObject({
      status: 403,
      cause: { kind: "organization_membership_required" },
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("persists the preferred organization inside the membership transaction", async () => {
    memberFindUniqueMock.mockResolvedValue({ id: "member_1" });
    userUpdateMock.mockResolvedValue(undefined);

    await setPreferredOrganizationId("user_1", "org_1");

    expect(memberFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: "user_1",
          organizationId: "org_1",
        },
      },
      select: { id: true },
    });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { preferredOrganizationId: "org_1" },
    });
  });
});

describe("setPreferredWorkspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    transactionMock.mockImplementation(async (callback) => {
      return await callback(tx);
    });
  });

  it("prefers the caller's personal workspace", async () => {
    workspaceFindUniqueMock
      .mockResolvedValueOnce({
        userId: "user_1",
        organizationId: null,
      })
      .mockResolvedValueOnce({ id: "ws_personal" });
    userUpdateMock.mockResolvedValue(undefined);

    await setPreferredWorkspace("user_1", "ws_personal");

    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { preferredOrganizationId: null },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("prefers an organization workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: null,
      organizationId: "org_1",
    });
    memberFindUniqueMock.mockResolvedValue({ id: "member_1" });
    userUpdateMock.mockResolvedValue(undefined);

    await setPreferredWorkspace("user_1", "ws_org");

    expect(memberFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: "user_1",
          organizationId: "org_1",
        },
      },
      select: { id: true },
    });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { preferredOrganizationId: "org_1" },
    });
  });

  it("throws 404 for an unknown workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);

    await expect(
      setPreferredWorkspace("user_1", "ws_missing"),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("throws 404 for another user's personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: "user_2",
      organizationId: null,
    });

    await expect(
      setPreferredWorkspace("user_1", "ws_other"),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
