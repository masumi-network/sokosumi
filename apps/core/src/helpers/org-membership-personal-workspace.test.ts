import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnvMock = vi.hoisted(() => vi.fn());
const ensurePersonalWorkspaceKeepingPreferredMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const userUpdateManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/config/env", () => ({
  getEnv: () => getEnvMock(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    ensurePersonalWorkspaceKeepingPreferred: (...args: unknown[]) =>
      ensurePersonalWorkspaceKeepingPreferredMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
    user: {
      updateMany: (...args: unknown[]) => userUpdateManyMock(...args),
    },
  },
}));

import {
  ensurePersonalWorkspaceForOrganizationMembership,
  pinPreferredOrganizationIfUnset,
} from "./org-membership-personal-workspace";

describe("ensurePersonalWorkspaceForOrganizationMembership", () => {
  const userFindUniqueMock = vi.fn();
  const userUpdateMock = vi.fn();
  const tx = {
    user: {
      findUnique: userFindUniqueMock,
      update: userUpdateMock,
    },
  } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback) => callback(tx));
    ensurePersonalWorkspaceKeepingPreferredMock.mockResolvedValue({
      created: true,
      workspace: { id: "ws-1" },
    });
    userFindUniqueMock.mockResolvedValue({ preferredOrganizationId: null });
  });

  it("does not create a personal workspace when REQUIRE_PERSONAL_WORKSPACE is false", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: false });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1", { tx });

    expect(ensurePersonalWorkspaceKeepingPreferredMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates a personal workspace in the given transaction when required", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: true });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1", { tx });

    expect(ensurePersonalWorkspaceKeepingPreferredMock).toHaveBeenCalledWith({
      userId: "user-1",
      tx,
    });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("opens a transaction when none is passed and the requirement is on", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: true });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1");

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(ensurePersonalWorkspaceKeepingPreferredMock).toHaveBeenCalledWith({
      userId: "user-1",
      tx,
    });
  });

  it("pins preferred organization when this call created personal and preferred is null", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: true });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1", {
      tx,
      organizationId: "org-1",
    });

    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { preferredOrganizationId: "org-1" },
    });
  });

  it("does not pin preferred when personal already existed", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: true });
    ensurePersonalWorkspaceKeepingPreferredMock.mockResolvedValue({
      created: false,
      workspace: { id: "ws-existing" },
    });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1", {
      tx,
      organizationId: "org-1",
    });

    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("does not pin preferred when it is already set", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: true });
    userFindUniqueMock.mockResolvedValue({
      preferredOrganizationId: "org-existing",
    });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1", {
      tx,
      organizationId: "org-1",
    });

    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});

describe("pinPreferredOrganizationIfUnset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when REQUIRE_PERSONAL_WORKSPACE is false", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: false });

    await pinPreferredOrganizationIfUnset("user-1", "org-1");

    expect(userUpdateManyMock).not.toHaveBeenCalled();
  });

  it("pins only when preferred is currently null", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: true });

    await pinPreferredOrganizationIfUnset("user-1", "org-1");

    expect(userUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "user-1", preferredOrganizationId: null },
      data: { preferredOrganizationId: "org-1" },
    });
  });
});
