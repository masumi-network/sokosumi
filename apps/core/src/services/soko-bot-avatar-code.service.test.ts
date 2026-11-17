import {
  buildAvatarSvg,
  formatAvatarCode,
  originalAvatarLook,
  parseAvatarCode,
} from "@sokosumi/soko-bot";
import { expectConsole } from "@sokosumi/utils/test-console";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  put: vi.fn(),
  sharp: vi.fn(),
  toBuffer: vi.fn(),
  token: "token" as string | undefined,
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ BLOB_READ_WRITE_TOKEN: m.token }),
}));
vi.mock("@vercel/blob", () => ({ put: m.put }));
vi.mock("sharp", () => ({ default: m.sharp }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findFirst: m.findFirst, update: m.update },
  },
}));

import {
  assignRandomAvatarCode,
  giveNewSokoBotAvatar,
  renderAvatarCode,
  setSokoBotAvatarCode,
} from "./soko-bot-avatar-code.service";

const CODE = formatAvatarCode(originalAvatarLook("owl"));
const URL = "https://blob.example/code.webp";

beforeEach(() => {
  vi.clearAllMocks();
  m.token = "token";
  m.findFirst.mockResolvedValue(null);
  m.update.mockResolvedValue({ id: "bot" });
  m.put.mockResolvedValue({ url: URL });
  m.toBuffer.mockResolvedValue(Buffer.from("webp"));
  const chain = { resize: vi.fn(), webp: vi.fn(), toBuffer: m.toBuffer };
  chain.resize.mockReturnValue(chain);
  chain.webp.mockReturnValue(chain);
  m.sharp.mockReturnValue(chain);
});

const kindOf = (error: unknown) =>
  (error as { cause?: { kind?: string } }).cause?.kind;

describe("setSokoBotAvatarCode", () => {
  it("renders the built SVG and writes code and image together", async () => {
    const result = await setSokoBotAvatarCode("bot", CODE);

    expect(m.sharp).toHaveBeenCalledWith(
      Buffer.from(buildAvatarSvg(parseAvatarCode(CODE)!)),
    );
    expect(m.put).toHaveBeenCalledWith(
      `soko-bots/avatars/code/${CODE}.webp`,
      expect.any(Buffer),
      expect.objectContaining({ access: "public", allowOverwrite: true }),
    );
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "bot" },
      data: { avatarCode: CODE, avatarImageUrl: URL },
      select: { id: true },
    });
    expect(result).toEqual({ avatarCode: CODE, avatarImageUrl: URL });
  });

  it("answers 422 for an invalid code without rendering", async () => {
    const error = await setSokoBotAvatarCode("bot", "nope").catch((e) => e);

    expect(error.status).toBe(422);
    expect(kindOf(error)).toBe("avatar_code_invalid");
    expect(m.put).not.toHaveBeenCalled();
  });

  it("answers 409 when another bot holds the code", async () => {
    m.findFirst.mockResolvedValue({ id: "other" });

    const error = await setSokoBotAvatarCode("bot", CODE).catch((e) => e);

    expect(error.status).toBe(409);
    expect(kindOf(error)).toBe("avatar_code_taken");
    expect(m.put).not.toHaveBeenCalled();
  });

  it("answers 409 when the unique index loses a race", async () => {
    m.update.mockRejectedValue({ code: "P2002" });

    const error = await setSokoBotAvatarCode("bot", CODE).catch((e) => e);

    expect(error.status).toBe(409);
  });
});

describe("assignRandomAvatarCode", () => {
  it("draws again when a code is taken", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "other" }).mockResolvedValue(null);

    const result = await assignRandomAvatarCode("bot");

    expect(m.findFirst).toHaveBeenCalledTimes(2);
    expect(parseAvatarCode(result.avatarCode)).not.toBeNull();
  });

  it("gives up after repeated conflicts", async () => {
    m.findFirst.mockResolvedValue({ id: "other" });

    await expect(assignRandomAvatarCode("bot")).rejects.toThrow(
      "No free avatar look",
    );
    expect(m.findFirst).toHaveBeenCalledTimes(8);
  });

  it("rethrows errors that are not conflicts", async () => {
    m.put.mockRejectedValue(new Error("blob down"));

    await expect(assignRandomAvatarCode("bot")).rejects.toThrow("blob down");
  });
});

describe("giveNewSokoBotAvatar", () => {
  it("saves the picked look", async () => {
    await expect(giveNewSokoBotAvatar("bot", CODE)).resolves.toEqual({
      avatarCode: CODE,
      avatarImageUrl: URL,
    });
  });

  it("falls back to a random look when the picked one is taken", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "other" }).mockResolvedValue(null);
    const saved = await giveNewSokoBotAvatar("bot", CODE);
    expect(saved?.avatarCode).not.toBe(CODE);
    expect(parseAvatarCode(saved?.avatarCode ?? "")).not.toBeNull();
  });

  it("skips the look quietly where Blob is not configured (tests, local)", async () => {
    m.token = undefined;
    await expect(giveNewSokoBotAvatar("bot", CODE)).resolves.toBeNull();
    expect(m.put).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("leaves the bot faceless instead of failing the create", async () => {
    m.put.mockRejectedValue(new Error("blob down"));
    expectConsole("error", "Soko Bot avatar code failed");
    await expect(giveNewSokoBotAvatar("bot", CODE)).resolves.toBeNull();
  });
});

describe("renderAvatarCode", () => {
  it("refuses an invalid code", async () => {
    await expect(renderAvatarCode("nope")).rejects.toThrow("Invalid");
  });
});
