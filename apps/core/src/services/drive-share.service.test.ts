import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: "test-secret",
    BLOB_READ_WRITE_TOKEN: "t",
  }),
}));
const blob = vi.hoisted(() => ({ head: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
const db = vi.hoisted(() => ({
  driveShare: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

import {
  createUnlockProof,
  driveShareDownloadUrl,
  hashSharePassword,
  isUnlocked,
  shareFolderPath,
  unlockDriveShare,
  verifySharePassword,
} from "./drive-share.service";

describe("share passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashSharePassword("fundraising-2026");
    expect(hash).toMatch(/^scrypt\$/);
    await expect(verifySharePassword(hash, "fundraising-2026")).resolves.toBe(
      true,
    );
    await expect(verifySharePassword(hash, "fundraising-2025")).resolves.toBe(
      false,
    );
  });
});

describe("unlock proofs", () => {
  const share = { id: "s1", passwordHash: "scrypt$a$b" };

  it("opens a link without a password with no proof", () => {
    expect(isUnlocked({ id: "s1", passwordHash: null }, undefined)).toBe(true);
  });

  it("accepts a fresh proof and rejects a missing, forged or expired one", () => {
    const now = 1_000_000;
    const proof = createUnlockProof(share, now);
    expect(isUnlocked(share, proof, now + 1_000)).toBe(true);
    expect(isUnlocked(share, undefined, now)).toBe(false);
    expect(isUnlocked(share, `${now + 999_999}.forged`, now)).toBe(false);
    expect(isUnlocked(share, proof, now + 13 * 60 * 60 * 1000)).toBe(false);
  });

  it("ends earlier unlocks when the password changes", () => {
    const proof = createUnlockProof(share);
    expect(isUnlocked({ ...share, passwordHash: "scrypt$c$d" }, proof)).toBe(
      false,
    );
  });
});

describe("unlockDriveShare", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts wrong passwords and locks the link after ten", async () => {
    const passwordHash = await hashSharePassword("right");
    db.driveShare.findUnique.mockResolvedValue({
      id: "s1",
      passwordHash,
      failedUnlocks: 9,
      unlockLockedAt: null,
    });
    await expect(unlockDriveShare("tok", "wrong", 5_000)).resolves.toEqual({
      kind: "wrong",
    });
    expect(db.driveShare.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { failedUnlocks: 0, unlockLockedAt: new Date(5_000) },
    });
  });

  it("refuses even the right password while locked", async () => {
    db.driveShare.findUnique.mockResolvedValue({
      id: "s1",
      passwordHash: await hashSharePassword("right"),
      failedUnlocks: 0,
      unlockLockedAt: new Date(5_000),
    });
    const outcome = await unlockDriveShare("tok", "right", 6_000);
    expect(outcome.kind).toBe("locked");
  });

  it("gives a proof for the right password and resets the count", async () => {
    db.driveShare.findUnique.mockResolvedValue({
      id: "s1",
      passwordHash: await hashSharePassword("right"),
      failedUnlocks: 3,
      unlockLockedAt: null,
    });
    const outcome = await unlockDriveShare("tok", "right");
    expect(outcome.kind).toBe("unlocked");
    expect(db.driveShare.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { failedUnlocks: 0, unlockLockedAt: null },
    });
  });
});

describe("shareFolderPath", () => {
  it("normalizes and refuses the root and dot segments", () => {
    expect(shareFolderPath("/Masumi Fundraising/")).toBe("Masumi Fundraising");
    expect(() => shareFolderPath("")).toThrow();
    expect(() => shareFolderPath("a/../b")).toThrow();
  });
});

describe("driveShareDownloadUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.driveShare.findUnique.mockResolvedValue({
      id: "s1",
      kind: "FOLDER",
      sourceScope: "ORGANIZATION",
      ownerId: "org_1",
      folderPath: "Masumi Fundraising",
      passwordHash: null,
      resource: null,
    });
    blob.head.mockImplementation(async (pathname: string) => ({
      url: `https://store.public.blob.vercel-storage.com/${pathname}`,
    }));
  });

  it("downloads a file inside the shared folder", async () => {
    const url = await driveShareDownloadUrl({
      token: "tok",
      proof: undefined,
      path: "deck.pdf",
    });
    expect(url).toContain(
      "drive/organizations/org_1/Masumi%20Fundraising/deck.pdf",
    );
    expect(url).toContain("download=1");
  });

  it("never reaches outside the shared folder", async () => {
    await expect(
      driveShareDownloadUrl({
        token: "tok",
        proof: undefined,
        path: "../secret.pdf",
      }),
    ).resolves.toBeNull();
    expect(blob.head).not.toHaveBeenCalled();
  });

  it("asks for the password before a download", async () => {
    db.driveShare.findUnique.mockResolvedValue({
      id: "s1",
      kind: "FOLDER",
      sourceScope: "ORGANIZATION",
      ownerId: "org_1",
      folderPath: "Masumi Fundraising",
      passwordHash: "scrypt$a$b",
      resource: null,
    });
    await expect(
      driveShareDownloadUrl({
        token: "tok",
        proof: undefined,
        path: "deck.pdf",
      }),
    ).resolves.toBeNull();
  });
});
