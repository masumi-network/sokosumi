import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserByIdMock = vi.fn();
const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const getMembersOrganizationIdsByUserIdMock = vi.fn();
const findPersonalWorkspaceMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
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
  default: { kind: "prisma" },
}));

import { resolveActiveOrganizationIdForSession } from "./preferred-organization.service";

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
});
