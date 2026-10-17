import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memberFindFirst: vi.fn(),
  integrationFindMany: vi.fn(),
  integrationDelete: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    member: { findFirst: mocks.memberFindFirst },
    sokoBotIntegration: {
      findMany: mocks.integrationFindMany,
      delete: mocks.integrationDelete,
    },
  },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  revokeSokoBotIntegrationAccounts: mocks.revoke,
}));

import {
  disconnectLeaverSokoBotIntegrations,
  disconnectLeaverSokoBotIntegrationsBestEffort,
  sweepLeaverSokoBotIntegrations,
} from "./soko-bot-integration-leaver.service";

const ACCOUNTS = {
  provider: "gmail",
  composioAccountId: "selected",
  pendingComposioAccountId: "pending",
};

function notFound() {
  return Object.assign(new Error("not found"), { code: "P2025" });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.memberFindFirst.mockResolvedValue(null);
  mocks.integrationDelete.mockResolvedValue(ACCOUNTS);
  mocks.revoke.mockResolvedValue({ revoked: 1, failed: [] });
});

describe("disconnectLeaverSokoBotIntegrations", () => {
  it("does nothing while the member is still in the Organization", async () => {
    mocks.memberFindFirst.mockResolvedValue({ id: "member" });
    await expect(
      disconnectLeaverSokoBotIntegrations("leaver", "org"),
    ).resolves.toBe(0);
    expect(mocks.memberFindFirst).toHaveBeenCalledWith({
      where: { userId: "leaver", organizationId: "org" },
      select: { id: true },
    });
    expect(mocks.integrationFindMany).not.toHaveBeenCalled();
    expect(mocks.integrationDelete).not.toHaveBeenCalled();
  });

  it("disconnects the leaver's shared bot integrations and keeps personal ones", async () => {
    mocks.integrationFindMany.mockResolvedValue([
      { id: "shared-row", sokoBotId: "shared-bot", sokoBot: { userId: null } },
      {
        id: "personal-row",
        sokoBotId: "personal-bot",
        sokoBot: { userId: "leaver" },
      },
    ]);
    await expect(
      disconnectLeaverSokoBotIntegrations("leaver", "org"),
    ).resolves.toBe(1);
    expect(mocks.integrationFindMany.mock.calls[0][0].where).toEqual({
      connectorUserId: "leaver",
      sokoBot: { workspace: { organizationId: "org" } },
    });
    expect(mocks.integrationDelete).toHaveBeenCalledOnce();
    expect(mocks.integrationDelete.mock.calls[0][0].where).toEqual({
      id: "shared-row",
      connectorUserId: "leaver",
    });
    expect(mocks.revoke).toHaveBeenCalledWith("shared-bot", [ACCOUNTS]);
  });

  it("skips a row that is gone or now belongs to another member", async () => {
    mocks.integrationFindMany.mockResolvedValue([
      { id: "shared-row", sokoBotId: "shared-bot", sokoBot: { userId: null } },
    ]);
    mocks.integrationDelete.mockRejectedValue(notFound());
    await expect(
      disconnectLeaverSokoBotIntegrations("leaver", "org"),
    ).resolves.toBe(0);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("surfaces any other database error", async () => {
    mocks.integrationFindMany.mockResolvedValue([
      { id: "shared-row", sokoBotId: "shared-bot", sokoBot: { userId: null } },
    ]);
    mocks.integrationDelete.mockRejectedValue(new Error("db down"));
    await expect(
      disconnectLeaverSokoBotIntegrations("leaver", "org"),
    ).rejects.toThrow("db down");
  });
});

describe("disconnectLeaverSokoBotIntegrationsBestEffort", () => {
  it("never fails the member removal", async () => {
    mocks.memberFindFirst.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      disconnectLeaverSokoBotIntegrationsBestEffort("leaver", "org"),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});

describe("sweepLeaverSokoBotIntegrations", () => {
  it("checks each shared bot connector once per Organization and disconnects leavers", async () => {
    mocks.integrationFindMany.mockImplementation(
      async (args: { where: { connectorUserId: unknown } }) => {
        if (typeof args.where.connectorUserId === "object") {
          const shared = (userId: string, organizationId: string) => ({
            connectorUserId: userId,
            sokoBot: { userId: null, workspace: { organizationId } },
          });
          return [
            shared("stayer", "org"),
            shared("leaver", "org"),
            shared("leaver", "org"),
            shared("leaver", "other-org"),
            {
              connectorUserId: "owner",
              sokoBot: {
                userId: "owner",
                workspace: { organizationId: "org" },
              },
            },
          ];
        }
        return [
          { id: "row", sokoBotId: "shared-bot", sokoBot: { userId: null } },
        ];
      },
    );
    mocks.memberFindFirst.mockImplementation(
      async (args: { where: { userId: string; organizationId: string } }) =>
        args.where.userId === "stayer" ||
        args.where.organizationId === "other-org"
          ? { id: "member" }
          : null,
    );

    await expect(sweepLeaverSokoBotIntegrations()).resolves.toBe(1);
    expect(
      mocks.memberFindFirst.mock.calls.map((call) => call[0].where),
    ).toEqual([
      { userId: "stayer", organizationId: "org" },
      { userId: "leaver", organizationId: "org" },
      { userId: "leaver", organizationId: "other-org" },
    ]);
    expect(mocks.integrationDelete).toHaveBeenCalledOnce();
    expect(mocks.integrationDelete.mock.calls[0][0].where).toEqual({
      id: "row",
      connectorUserId: "leaver",
    });
  });
});
