import { MemberRole } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";
import { isAuthenticatedCmoProjectOwner } from "./cmo-project-owner";

function mockClient(role: string | null) {
  const findFirst = vi.fn().mockResolvedValue(role ? { role } : null);
  return {
    client: { member: { findFirst } } as unknown as Parameters<
      typeof isAuthenticatedCmoProjectOwner
    >[1],
    findFirst,
  };
}

const FLAGGED_CMO = {
  profile: "cmo" as const,
  cmoOwnerAudience: true as const,
};

const UNFLAGGED_CMO = {
  profile: "cmo" as const,
};

const CMO_BOT = {
  userId: null,
  projectId: "proj-1",
  workspaceId: "ws-1",
  createdByUserId: "hirer-1",
  versionId: "cmo-v25",
};

describe("isAuthenticatedCmoProjectOwner", () => {
  it("returns true for an organization OWNER on a flagged CMO project bot", async () => {
    const { client, findFirst } = mockClient(MemberRole.OWNER);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: { ...CMO_BOT, createdByUserId: "someone-else" },
          version: FLAGGED_CMO,
          userId: "org-owner-1",
        },
        client,
      ),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: "org-owner-1",
        organization: { workspace: { is: { id: "ws-1" } } },
      },
      select: { role: true },
    });
  });

  it("returns true for the member who hired Cuso while they remain an active org member", async () => {
    const { client } = mockClient(MemberRole.MEMBER);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: CMO_BOT,
          version: FLAGGED_CMO,
          userId: "hirer-1",
        },
        client,
      ),
    ).resolves.toBe(true);
  });

  it("returns false for another workspace member or admin who did not hire Cuso", async () => {
    for (const role of [MemberRole.MEMBER, MemberRole.ADMIN]) {
      const { client } = mockClient(role);
      await expect(
        isAuthenticatedCmoProjectOwner(
          {
            bot: CMO_BOT,
            version: FLAGGED_CMO,
            userId: "teammate-2",
          },
          client,
        ),
      ).resolves.toBe(false);
    }
  });

  it("returns false for a former hirer who left the organization", async () => {
    const { client } = mockClient(null);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: CMO_BOT,
          version: FLAGGED_CMO,
          userId: "hirer-1",
        },
        client,
      ),
    ).resolves.toBe(false);
  });

  it("fails closed with zero DB queries when cmoOwnerAudience is omitted", async () => {
    const { client, findFirst } = mockClient(MemberRole.OWNER);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: CMO_BOT,
          version: UNFLAGGED_CMO,
          userId: "hirer-1",
        },
        client,
      ),
    ).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("never grants OWNER to another assistant, non-CMO shared bot, workspace-wide bot, or personal bot", async () => {
    const { client, findFirst } = mockClient(MemberRole.OWNER);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: CMO_BOT,
          version: FLAGGED_CMO,
          userId: "hirer-1",
          askedByBot: true,
        },
        client,
      ),
    ).resolves.toBe(false);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: CMO_BOT,
          version: FLAGGED_CMO,
          userId: "hirer-1",
          chainDepth: 1,
        },
        client,
      ),
    ).resolves.toBe(false);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: CMO_BOT,
          version: { cmoOwnerAudience: true },
          userId: "hirer-1",
        },
        client,
      ),
    ).resolves.toBe(false);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: { ...CMO_BOT, projectId: null },
          version: FLAGGED_CMO,
          userId: "hirer-1",
        },
        client,
      ),
    ).resolves.toBe(false);
    await expect(
      isAuthenticatedCmoProjectOwner(
        {
          bot: { ...CMO_BOT, userId: "hirer-1" },
          version: FLAGGED_CMO,
          userId: "hirer-1",
        },
        client,
      ),
    ).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
