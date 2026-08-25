import { beforeEach, describe, expect, it, vi } from "vitest";

const memberFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({
  default: {
    member: {
      findUnique: (...args: unknown[]) => memberFindUnique(...args),
    },
  },
}));

import type { AuthenticationContext } from "@/middleware/auth";

import {
  requireDriveFileAccess,
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "./drive-file-access";

function sessionAuth(
  userId: string,
  organizationId: string | null,
): AuthenticationContext {
  return {
    actor: "user",
    userId,
    organizationId,
    role: "user",
    authenticationMethod: "session",
  };
}

describe("requireDriveFileAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows personal drive in a personal workspace for the owner", async () => {
    await expect(
      requireDriveFileAccess(sessionAuth("user_1", null), "user", "user_1"),
    ).resolves.toBeUndefined();
    expect(memberFindUnique).not.toHaveBeenCalled();
  });

  it("rejects personal drive from an organization workspace", async () => {
    await expect(
      requireDriveFileAccess(sessionAuth("user_1", "org_a"), "user", "user_1"),
    ).rejects.toMatchObject({
      status: 403,
      message: "My Drive is only available in a personal workspace",
    });
    expect(memberFindUnique).not.toHaveBeenCalled();
  });

  it("rejects organization drive from a personal workspace", async () => {
    await expect(
      requireDriveFileAccess(
        sessionAuth("user_1", null),
        "organization",
        "org_a",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "Organization Drive is only available in an organization workspace",
    });
    expect(memberFindUnique).not.toHaveBeenCalled();
  });

  it("allows the active organization drive for a member", async () => {
    memberFindUnique.mockResolvedValue({
      userId: "user_1",
      organizationId: "org_a",
    });

    await expect(
      requireDriveFileAccess(
        sessionAuth("user_1", "org_a"),
        "organization",
        "org_a",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a different organization store even when the user is a member", async () => {
    memberFindUnique.mockResolvedValue({
      userId: "user_1",
      organizationId: "org_b",
    });

    await expect(
      requireDriveFileAccess(
        sessionAuth("user_1", "org_a"),
        "organization",
        "org_b",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "You can only access the Drive for the active organization workspace",
    });
    expect(memberFindUnique).not.toHaveBeenCalled();
  });
});

describe("requireUserDriveFileUploadAccess", () => {
  it("allows personal upload in a personal workspace", async () => {
    await expect(
      requireUserDriveFileUploadAccess(sessionAuth("user_1", null), "user_1"),
    ).resolves.toBeUndefined();
  });

  it("rejects personal upload from an organization workspace", async () => {
    await expect(
      requireUserDriveFileUploadAccess(
        sessionAuth("user_1", "org_a"),
        "user_1",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "My Drive is only available in a personal workspace",
    });
  });
});

describe("requireOrganizationDriveFileUploadAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects org upload from a personal workspace", async () => {
    await expect(
      requireOrganizationDriveFileUploadAccess(
        sessionAuth("user_1", null),
        "org_a",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "Organization Drive is only available in an organization workspace",
    });
    expect(memberFindUnique).not.toHaveBeenCalled();
  });

  it("rejects org upload for a store that is not the active workspace", async () => {
    await expect(
      requireOrganizationDriveFileUploadAccess(
        sessionAuth("user_1", "org_a"),
        "org_b",
      ),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "You can only access the Drive for the active organization workspace",
    });
    expect(memberFindUnique).not.toHaveBeenCalled();
  });

  it("allows org upload to the active workspace for a member", async () => {
    const organization = { id: "org_a", name: "Acme" };
    memberFindUnique.mockResolvedValue({
      userId: "user_1",
      organizationId: "org_a",
      organization,
    });

    await expect(
      requireOrganizationDriveFileUploadAccess(
        sessionAuth("user_1", "org_a"),
        "org_a",
      ),
    ).resolves.toEqual(organization);
  });
});
