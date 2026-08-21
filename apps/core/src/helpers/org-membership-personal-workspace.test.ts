import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnvMock = vi.hoisted(() => vi.fn());
const ensurePersonalWorkspaceKeepingPreferredMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

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
  },
}));

import { ensurePersonalWorkspaceForOrganizationMembership } from "./org-membership-personal-workspace";

describe("ensurePersonalWorkspaceForOrganizationMembership", () => {
  const tx = { kind: "tx" } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback) => callback(tx));
    ensurePersonalWorkspaceKeepingPreferredMock.mockResolvedValue({
      created: true,
      workspace: { id: "ws-1" },
    });
  });

  it("does not create a personal workspace when REQUIRE_PERSONAL_WORKSPACE is false", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: false });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1", tx);

    expect(ensurePersonalWorkspaceKeepingPreferredMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates a personal workspace in the given transaction when required", async () => {
    getEnvMock.mockReturnValue({ REQUIRE_PERSONAL_WORKSPACE: true });

    await ensurePersonalWorkspaceForOrganizationMembership("user-1", tx);

    expect(ensurePersonalWorkspaceKeepingPreferredMock).toHaveBeenCalledWith({
      userId: "user-1",
      tx,
    });
    expect(transactionMock).not.toHaveBeenCalled();
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
});
