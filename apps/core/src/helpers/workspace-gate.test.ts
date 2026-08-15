import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveWorkspaceGate, loadWorkspaceGate } from "./workspace-gate.js";

describe("deriveWorkspaceGate", () => {
  it("maps empty / empty / empty → identity-onboarding", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: false,
        hasPendingOrganizationInvites: false,
      }),
    ).toBe("identity-onboarding");
  });

  it("maps empty / empty / pending invites → pending-invites", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: false,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("pending-invites");
  });

  it("maps personal workspace → ready (pending invites ignored)", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: true,
        hasOrganizationMembership: false,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("ready");
  });

  it("maps org membership without personal → ready", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: true,
        hasPendingOrganizationInvites: false,
      }),
    ).toBe("ready");
  });

  it("maps personal and org membership → ready", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: true,
        hasOrganizationMembership: true,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("ready");
  });

  it("maps org membership with pending invites → ready (invites ignored)", () => {
    expect(
      deriveWorkspaceGate({
        hasPersonalWorkspace: false,
        hasOrganizationMembership: true,
        hasPendingOrganizationInvites: true,
      }),
    ).toBe("ready");
  });
});

describe("loadWorkspaceGate", () => {
  const userFindUnique = vi.fn();
  const workspaceFindUnique = vi.fn();
  const memberFindFirst = vi.fn();
  const invitationFindFirst = vi.fn();

  const tx = {
    user: { findUnique: userFindUnique },
    workspace: { findUnique: workspaceFindUnique },
    member: { findFirst: memberFindFirst },
    invitation: { findFirst: invitationFindFirst },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns identity-onboarding when the user row is missing", async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(loadWorkspaceGate("user_x", tx)).resolves.toEqual({
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
      gate: "identity-onboarding",
    });
    expect(workspaceFindUnique).not.toHaveBeenCalled();
  });

  it("returns identity-onboarding when empty / empty / empty", async () => {
    userFindUnique.mockResolvedValue({ email: "Ada@Example.com" });
    workspaceFindUnique.mockResolvedValue(null);
    memberFindFirst.mockResolvedValue(null);
    invitationFindFirst.mockResolvedValue(null);

    await expect(loadWorkspaceGate("user_1", tx)).resolves.toEqual({
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
      gate: "identity-onboarding",
    });

    expect(invitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "pending",
          email: { equals: "ada@example.com", mode: "insensitive" },
        }),
      }),
    );
  });

  it("returns pending-invites when only a non-expired invite exists", async () => {
    userFindUnique.mockResolvedValue({ email: "ada@example.com" });
    workspaceFindUnique.mockResolvedValue(null);
    memberFindFirst.mockResolvedValue(null);
    invitationFindFirst.mockResolvedValue({ id: "inv_1" });

    await expect(loadWorkspaceGate("user_1", tx)).resolves.toEqual({
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
      gate: "pending-invites",
    });
  });

  it("returns ready for personal workspace only (ignores invites)", async () => {
    userFindUnique.mockResolvedValue({ email: "ada@example.com" });
    workspaceFindUnique.mockResolvedValue({ id: "ws_1" });
    memberFindFirst.mockResolvedValue(null);
    invitationFindFirst.mockResolvedValue({ id: "inv_1" });

    await expect(loadWorkspaceGate("user_1", tx)).resolves.toEqual({
      hasPersonalWorkspace: true,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
      gate: "ready",
    });
  });

  it("returns ready for org membership without personal workspace", async () => {
    userFindUnique.mockResolvedValue({ email: "ada@example.com" });
    workspaceFindUnique.mockResolvedValue(null);
    memberFindFirst.mockResolvedValue({ id: "member_1" });
    invitationFindFirst.mockResolvedValue(null);

    await expect(loadWorkspaceGate("user_1", tx)).resolves.toEqual({
      hasPersonalWorkspace: false,
      hasOrganizationMembership: true,
      hasPendingOrganizationInvites: false,
      gate: "ready",
    });
  });

  it("queries pending invites with expiresAt greater than now", async () => {
    const before = Date.now();
    userFindUnique.mockResolvedValue({ email: "ada@example.com" });
    workspaceFindUnique.mockResolvedValue(null);
    memberFindFirst.mockResolvedValue(null);
    invitationFindFirst.mockResolvedValue(null);

    await loadWorkspaceGate("user_1", tx);
    const after = Date.now();

    const call = invitationFindFirst.mock.calls[0]?.[0] as {
      where: { expiresAt: { gt: Date } };
    };
    const gt = call.where.expiresAt.gt.getTime();
    expect(gt).toBeGreaterThanOrEqual(before);
    expect(gt).toBeLessThanOrEqual(after);
  });
});
