import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    sokoBotAdminAction: { findFirst: vi.fn() },
    cmoUpgradeSeen: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  requireCuso: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@/services/cmo-cuso.service", () => ({
  requireCuso: m.requireCuso,
}));

const { cmoUpgradeFor, markCmoUpgradeSeen } = await import(
  "./cmo-upgrade.service"
);

const input = { sokoBotId: "bot-1", versionId: "cmo-v15", userId: "user-1" };
const move = (from: string | null, to: string) => ({
  before: from ? { status: "IDLE", versionId: from } : { status: "IDLE" },
  after: { status: "IDLE", versionId: to },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.sokoBotAdminAction.findFirst.mockResolvedValue(
    move("cmo-v13", "cmo-v15"),
  );
  m.prisma.cmoUpgradeSeen.findUnique.mockResolvedValue(null);
});

describe("cmoUpgradeFor", () => {
  it("says what changed after a move onto a newer version", async () => {
    const upgrade = await cmoUpgradeFor(input);
    expect(upgrade?.versionId).toBe("cmo-v15");
    expect(upgrade?.lines).toHaveLength(3);
    expect(m.prisma.sokoBotAdminAction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sokoBotId: "bot-1",
          action: "SET_VERSION",
          status: "SUCCEEDED",
        },
      }),
    );
  });

  it("stays closed once the member closed it", async () => {
    m.prisma.cmoUpgradeSeen.findUnique.mockResolvedValue({
      seenAt: new Date(),
    });
    expect(await cmoUpgradeFor(input)).toBeNull();
  });

  it("shows nothing for a Cuso hired on his version", async () => {
    m.prisma.sokoBotAdminAction.findFirst.mockResolvedValue(null);
    expect(await cmoUpgradeFor(input)).toBeNull();
  });

  it("shows nothing for a move back or one he has since left", async () => {
    m.prisma.sokoBotAdminAction.findFirst.mockResolvedValue(
      move("cmo-v15", "cmo-v13"),
    );
    expect(await cmoUpgradeFor({ ...input, versionId: "cmo-v13" })).toBeNull();
    m.prisma.sokoBotAdminAction.findFirst.mockResolvedValue(
      move("cmo-v13", "cmo-v14"),
    );
    expect(await cmoUpgradeFor(input)).toBeNull();
  });

  it("shows nothing when the move's starting version is unknown", async () => {
    m.prisma.sokoBotAdminAction.findFirst.mockResolvedValue(
      move(null, "cmo-v15"),
    );
    expect(await cmoUpgradeFor(input)).toBeNull();
  });
});

describe("markCmoUpgradeSeen", () => {
  it("keeps one row per member, Cuso and version", async () => {
    m.requireCuso.mockResolvedValue({ sokoBotId: "bot-1" });
    await markCmoUpgradeSeen({ userId: "user-1", projectId: "p-1" }, "cmo-v15");
    expect(m.prisma.cmoUpgradeSeen.upsert).toHaveBeenCalledWith({
      where: {
        userId_sokoBotId_versionId: {
          userId: "user-1",
          sokoBotId: "bot-1",
          versionId: "cmo-v15",
        },
      },
      create: { userId: "user-1", sokoBotId: "bot-1", versionId: "cmo-v15" },
      update: {},
    });
  });
});
