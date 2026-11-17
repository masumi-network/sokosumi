import {
  AVATAR_ANIMALS,
  AVATAR_BACKGROUNDS,
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
  updateMany: vi.fn(),
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
    sokoBotAvatar: { updateMany: m.updateMany },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

import {
  assignRandomAvatarCode,
  giveNewSokoBotAvatar,
  POOL_BACKGROUNDS,
  POOL_SUBJECT_ANIMALS,
  planAvatarCodes,
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
  m.updateMany.mockResolvedValue({ count: 0 });
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
    // Never touches the pool table: it is dropped while this code may still serve.
    expect(m.updateMany).not.toHaveBeenCalled();
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

describe("pool mapping", () => {
  const POOL_SUBJECTS = [
    "owl",
    "fox",
    "round helper robot",
    "bear cub",
    "whale",
    "cat",
    "penguin",
    "sloth",
    "axolotl",
    "frog",
    "elephant",
    "koala",
    "duckling",
    "hedgehog",
    "rabbit",
    "otter",
  ];
  const POOL_BACKGROUND_NAMES = [
    "iris flower pink",
    "golden yellow",
    "crimson purple",
    "peach blossom pink",
    "persimmon orange",
    "vivid sakura pink",
    "sand",
    "electric pink",
    "scarlet red",
  ];

  it("maps all 16 subjects onto the 16 animals", () => {
    expect(POOL_SUBJECTS.map((s) => POOL_SUBJECT_ANIMALS[s]).sort()).toEqual(
      [...AVATAR_ANIMALS].sort(),
    );
  });

  it("maps all 9 backgrounds onto the 9 palette backgrounds", () => {
    expect(
      POOL_BACKGROUND_NAMES.map((b) => POOL_BACKGROUNDS[b]).sort(),
    ).toEqual([...AVATAR_BACKGROUNDS].sort());
    expect(POOL_BACKGROUNDS["ink black"]).toBeUndefined();
  });
});

describe("planAvatarCodes", () => {
  it("gives two bots with the same picture different codes", () => {
    const held = new Set<string>();
    const same = { subject: "owl", background: "golden yellow" };

    const plan = planAvatarCodes(
      [
        { id: "a", ...same },
        { id: "b", ...same },
      ],
      held,
    );

    expect(plan.get("a")).not.toBe(plan.get("b"));
    expect(parseAvatarCode(plan.get("a")!)?.animal).toBe("owl");
    expect(parseAvatarCode(plan.get("a")!)?.bg).toBe("golden");
    expect(held.size).toBe(2);
  });

  it("skips codes already held and falls back to random without a picture", () => {
    const first = [
      ...planAvatarCodes([{ id: "x", subject: "fox" }], new Set()),
    ][0]![1];

    const plan = planAvatarCodes(
      [{ id: "a", subject: "fox" }, { id: "b" }],
      new Set([first]),
    );

    expect(plan.get("a")).not.toBe(first);
    expect(parseAvatarCode(plan.get("b")!)).not.toBeNull();
  });
});
