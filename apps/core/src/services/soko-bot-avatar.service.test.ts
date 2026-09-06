import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { avatarCountMock, avatarFindManyMock, getEnvMock, putMock } = vi.hoisted(
  () => ({
    avatarCountMock: vi.fn(),
    avatarFindManyMock: vi.fn(),
    getEnvMock: vi.fn(),
    putMock: vi.fn(),
  }),
);

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({ put: putMock }));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: async () => ({
    disabled: false,
    disabledAt: null,
    disabledReason: null,
  }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotAvatar: {
      count: avatarCountMock,
      findMany: avatarFindManyMock,
      create: vi.fn(),
    },
  },
}));

import {
  AVATAR_POOL_FLOOR,
  generateAvatars,
  listAvailableAvatars,
  persistAvatarImage,
  stockAvatarPool,
} from "@/services/soko-bot-avatar.service";

describe("Soko Bot avatar pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ FAL_KEY: "fal-test" });
    avatarFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing without an image key, so the pool just stays empty", async () => {
    getEnvMock.mockReturnValue({});
    avatarCountMock.mockResolvedValue(0);

    await expect(stockAvatarPool()).resolves.toEqual({
      available: 0,
      generated: 0,
    });
    expect(avatarCountMock).not.toHaveBeenCalled();
  });

  it("leaves a full pool alone", async () => {
    avatarCountMock.mockResolvedValue(AVATAR_POOL_FLOOR);

    await expect(stockAvatarPool()).resolves.toEqual({
      available: AVATAR_POOL_FLOOR,
      generated: 0,
    });
  });

  it("never generates for a plain read, so a page render cannot stall on fal.ai", async () => {
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(12);

    // The sidebar reads on every route; stocking is the cron's job there.
    expect(avatarCountMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(avatarFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("buys one image, not six, when storing them is broken", async () => {
    // fal bills for an image whether or not we store it. With a broken blob
    // token the pool never fills, so an ungated run would buy six every cron
    // tick for ever while writing nothing louder than a warning.
    getEnvMock.mockReturnValue({
      FAL_KEY: "key",
      BLOB_READ_WRITE_TOKEN: "token",
    });
    avatarFindManyMock.mockResolvedValue([]);
    // Two fetches per draw: the billed generation, then the download we store.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [{ url: "https://fal.test/a.png" }] }),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchMock);
    putMock.mockRejectedValue(new Error("blob token rejected"));

    const generated = await generateAvatars(6);

    expect(generated).toBe(0);
    // One billed generation, then it stops rather than paying for five more.
    const billed = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("fal.run"),
    );
    expect(billed).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("puts the PNG under soko-bots/avatars/{key}-{12hex}.png", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash12 = createHash("sha256")
      .update(bytes)
      .digest("hex")
      .slice(0, 12);
    getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "token" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    putMock.mockResolvedValue({ url: "https://blob.test/owl.png" });

    await persistAvatarImage("https://fal.test/a.png", "owl-1");

    const pathname = putMock.mock.calls[0]?.[0];
    expect(pathname).toBe(`soko-bots/avatars/owl-1-${hash12}.png`);
    expect(pathname).not.toContain("soko-bot-avatars/");
  });

  it("fills a short pool when the caller opts in", async () => {
    // Vercel runs crons on production only, so the creation picker asks for
    // this explicitly rather than showing an empty grid on a preview.
    avatarCountMock.mockResolvedValue(0);

    await listAvailableAvatars(6, { topUp: true });

    expect(avatarCountMock).toHaveBeenCalled();
  });
});
