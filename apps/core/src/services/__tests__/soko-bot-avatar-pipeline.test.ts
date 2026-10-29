import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Prisma } from "@sokosumi/database";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SokoBotAvatarStyle } from "@/lib/soko-bot-avatar/style";

/**
 * Seam 1: the avatar pipeline end to end. The Gateway adapter is faked, and so
 * are Blob, Prisma (an in-memory table that honours the filters the pipeline
 * uses) and env. ffmpeg is real: the levels step and the MP4 loops are
 * proven on a tiny generated still and clip.
 */

const { providerMock, blobFiles, blobTypes, getEnvMock, swapScene } =
  vi.hoisted(() => ({
    blobTypes: new Map<string, string>(),
    swapScene: { buffer: Buffer.alloc(0) as Buffer },
    providerMock: {
      editImage: vi.fn(),
      rewrite: vi.fn(),
      startVideo: vi.fn(),
      pollVideo: vi.fn(),
    },
    blobFiles: new Map<string, Buffer>(),
    getEnvMock: vi.fn(),
  }));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@vercel/blob", () => ({
  put: async (
    pathname: string,
    body: Buffer,
    options: { contentType: string },
  ) => {
    const url = `https://blob.test/${pathname}`;
    blobFiles.set(url, Buffer.from(body));
    blobTypes.set(url, options.contentType);
    return { url };
  },
}));
vi.mock("@/lib/soko-bot-avatar/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot-avatar/provider")>()),
  avatarProvider: () => providerMock,
}));
// The swap style brings its own tiny scene; every other style reads its bundled file.
vi.mock("@/lib/soko-bot-avatar/draw", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/soko-bot-avatar/draw")>();
  return {
    ...actual,
    loadHouseScene: (style: SokoBotAvatarStyle) =>
      style.id === "swap-test"
        ? Promise.resolve(swapScene.buffer)
        : actual.loadHouseScene(style),
  };
});
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: async () => ({
    disabled: false,
    disabledAt: null,
    disabledReason: null,
  }),
}));

// ---- an in-memory stand-in for the three tables the pipeline touches ----

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return a === b;
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

function test(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    return same(value, cond);
  }
  const c = cond as Row;
  if ("in" in c) return (c.in as unknown[]).some((one) => same(one, value));
  if ("notIn" in c)
    return !(c.notIn as unknown[]).some((one) => same(one, value));
  if ("not" in c) return !same(value, c.not);
  if ("lt" in c || "lte" in c || "gt" in c || "gte" in c) {
    if (value === null || value === undefined) return false;
    return (
      (!("lt" in c) || compare(value, c.lt) < 0) &&
      (!("gte" in c) || compare(value, c.gte) >= 0) &&
      (!("gt" in c) || compare(value, c.gt) > 0)
    );
  }
  // A nested filter on a relation.
  return value ? matches(value as Row, c) : false;
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) =>
    key === "OR"
      ? (cond as Row[]).some((one) => matches(row, one))
      : test(row[key], cond),
  );
}

function apply(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    const increment =
      value && typeof value === "object" && "increment" in (value as Row);
    row[key] = increment
      ? (row[key] as number) + ((value as Row).increment as number)
      : // Prisma's marker for SQL NULL in a Json column.
        value === Prisma.DbNull
        ? null
        : value;
  }
}

let clock = 0;
const tick = () => new Date(Date.now() + (clock += 1));

/** The one unique index the pipeline leans on: (styleId, styleVersion, traitKey). */
function sharesTraitKey(a: Row, b: Row): boolean {
  return (
    a.traitKey != null &&
    a.traitKey === b.traitKey &&
    a.styleId === b.styleId &&
    a.styleVersion === b.styleVersion
  );
}

class Table {
  rows: Row[] = [];
  constructor(
    private readonly defaults: () => Row,
    private readonly view: (row: Row) => Row = (row) => row,
    private readonly clashes: (a: Row, b: Row) => boolean = () => false,
  ) {}
  /** What Postgres does with a unique index: refuse, as Prisma's P2002. */
  private assertUnique(candidate: Row, self?: Row) {
    if (
      this.rows.some(
        (row) =>
          row !== self && row !== candidate && this.clashes(row, candidate),
      )
    ) {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
    }
  }
  reset() {
    this.rows = [];
  }
  private visible(row: Row) {
    return this.view(row);
  }
  async create({ data }: { data: Row }) {
    const row = {
      id: crypto.randomUUID(),
      createdAt: tick(),
      updatedAt: tick(),
      ...this.defaults(),
      ...data,
    };
    this.assertUnique(row);
    this.rows.push(row);
    return row;
  }
  async createMany({ data }: { data: Row[] }) {
    for (const one of data) {
      if (
        this.rows.some(
          (row) => row.avatarId === one.avatarId && row.state === one.state,
        )
      ) {
        continue;
      }
      await this.create({ data: one });
    }
    return { count: data.length };
  }
  async findFirst({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) {
    return (await this.findMany({ where, orderBy, take: 1 }))[0] ?? null;
  }
  async findUnique({ where }: { where: Row }) {
    return this.rows.find((row) => matches(row, where)) ?? null;
  }
  async findMany({
    where,
    orderBy,
    take,
  }: {
    where?: Row;
    orderBy?: Row;
    take?: number;
  } = {}) {
    let found = this.rows.filter((row) => matches(this.visible(row), where));
    if (orderBy) {
      const [[key, direction]] = Object.entries(orderBy) as [[string, string]];
      found = [...found].sort(
        (a, b) => compare(a[key], b[key]) * (direction === "desc" ? -1 : 1),
      );
    }
    return found.slice(0, take).map((row) => this.visible(row));
  }
  async count({ where }: { where?: Row } = {}) {
    return (await this.findMany({ where })).length;
  }
  async update({ where, data }: { where: Row; data: Row }) {
    const row = this.rows.find((one) => matches(one, where));
    if (!row) throw new Error("not found");
    apply(row, data);
    return row;
  }
  async updateMany({ where, data }: { where: Row; data: Row }) {
    const found = this.rows.filter((row) => matches(this.visible(row), where));
    for (const row of found) {
      this.assertUnique({ ...row, ...data }, row);
      apply(row, data);
      row.updatedAt = tick();
    }
    return { count: found.length };
  }
  async deleteMany({ where }: { where: Row }) {
    const doomed = this.rows.filter((row) => matches(row, where));
    this.rows = this.rows.filter((row) => !doomed.includes(row));
    return { count: doomed.length };
  }
}

const { db } = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));

vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/lib/db/transaction", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/transaction")>(
    "@/lib/db/transaction",
  )),
  serializableTransaction: async (run: (tx: unknown) => unknown) => run(db),
}));

const avatars = new Table(
  () => ({
    traitKey: null,
    claimedBySokoBotId: null,
    claimedAt: null,
    reservedAt: null,
    requestedByUserId: null,
    look: null,
    parentAvatarId: null,
    draftForSokoBotId: null,
    draftExpiresAt: null,
    keptAt: null,
    keptByUserId: null,
    fromPool: false,
    styleId: "mascot",
    styleVersion: 1,
  }),
  (row) => row,
  sharesTraitKey,
);
// A render row sees its avatar, as `include`/relation filters do in Prisma.
const renders = new Table(
  () => ({
    status: "PENDING",
    attempts: 0,
    leaseUntil: null,
    providerOperation: null,
    submittedAt: null,
    lastError: null,
    stillUrl: null,
    loopUrl: null,
    loopLargeUrl: null,
  }),
  (row) => {
    const avatar = avatars.rows.find((one) => one.id === row.avatarId);
    return {
      ...row,
      avatar: avatar && {
        ...avatar,
        claimedBySokoBot: avatar.claimedBySokoBotId
          ? {
              deletedAt: deletedBots.has(avatar.claimedBySokoBotId as string)
                ? new Date()
                : null,
            }
          : null,
      },
    };
  },
);
const bots: Row = { id: "bot-1", avatarImageUrl: null };
const deletedBots = new Set<string>();
Object.assign(db, {
  sokoBotAvatar: avatars,
  sokoBotAvatarRender: renders,
  sokoBot: {
    update: async ({ data }: { data: Row }) => Object.assign(bots, data),
  },
});

import { LIMITS } from "@/config/constants";
import { levelStill } from "@/lib/soko-bot-avatar/media";
import {
  AVATAR_IMAGE_FALLBACK_MODEL,
  AVATAR_IMAGE_MODEL,
  IMAGE_TIMEOUT_RENDER_MS,
  IMAGE_TIMEOUT_STUDIO_FALLBACK_MS,
  IMAGE_TIMEOUT_STUDIO_MS,
  ImageTimeoutError,
  VideoSubmissionUncertainError,
} from "@/lib/soko-bot-avatar/provider";
import {
  AVATAR_STATES,
  AVATAR_STYLES,
  CRAFTED_DESK_STYLE,
  lookFromSeed,
  traitKeyOf,
} from "@/lib/soko-bot-avatar/style";
import {
  claimAvatar,
  generateAvatars,
  sweepExpiredDrafts,
} from "@/services/soko-bot-avatar.service";
import {
  COLLECT_MIN_BUDGET_MS,
  MAX_COLLECTS_PER_RUN,
  MAX_RENDER_ATTEMPTS,
  reconcileAvatarRenders,
  STILL_MIN_BUDGET_MS,
  UNCERTAIN_WAIT_MS,
} from "@/services/soko-bot-avatar-render.service";
import {
  createAvatarDraft,
  discardAvatarDrafts,
  keepAvatarDraft,
} from "@/services/soko-bot-avatar-studio.service";

// ---- real ffmpeg fixtures ----

const BOT = "bot-1";
const USER = "user-1";
let scratch: string;
let fixturePng: Buffer;
let fixtureClip: Buffer;

function ffmpeg(args: string[], input?: Buffer): Buffer {
  return execFileSync(ffmpegPath as string, ["-v", "error", "-y", ...args], {
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The colour of one pixel of a WebP, decoded by libwebp as browsers do.
 * ffmpeg's own decoder converts YUV differently and reads 1-2 levels off.
 */
async function pixel(webp: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(webp)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 3;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

/** The size of a lossy WebP still, read from its own header. */
function webpInfo(file: Buffer) {
  expect(file.subarray(0, 4).toString()).toBe("RIFF");
  expect(file.subarray(8, 12).toString()).toBe("WEBP");
  expect(file.subarray(12, 16).toString()).toBe("VP8 ");
  return {
    width: (file[26]! | (file[27]! << 8)) & 0x3fff,
    height: (file[28]! | (file[29]! << 8)) & 0x3fff,
  };
}

/** What ffmpeg reports about an MP4: its streams, and where the index sits. */
function mp4Info(file: Buffer) {
  const probe = spawnSync(
    ffmpegPath as string,
    ["-hide_banner", "-i", "pipe:0"],
    {
      input: file,
      encoding: "utf8",
    },
  );
  const report = probe.stderr;
  const video =
    /Stream #0:\d+.*Video: (\w+) \((\w+)\).*?, (\d+)x(\d+).*?, ([\d.]+) fps/.exec(
      report,
    );
  return {
    codec: video?.[1],
    profile: video?.[2],
    width: Number(video?.[3]),
    height: Number(video?.[4]),
    fps: Number(video?.[5]),
    hasAudio: /Audio:/.test(report),
    pixelFormat: /Video: .*?yuv420p/.test(report) ? "yuv420p" : "other",
    // Faststart: the index comes before the media data, so it plays while it loads.
    indexFirst:
      file.indexOf("moov") !== -1 &&
      file.indexOf("moov") < file.indexOf("mdat"),
  };
}

/** The red channel of one pixel of the first frame of an MP4. */
function mp4Corner(file: Buffer): number {
  const raw = ffmpeg(
    [
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    file,
  );
  const side = Math.sqrt(raw.length / 3);
  return raw[(3 * side + 3) * 3]!;
}

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "avatar-pipeline-test-"));
  // A 128 px still on a light gray background that is not yet #F5F5F5.
  fixturePng = ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0xEBEBEB:s=128x128:d=1",
    "-vf",
    "drawbox=x=40:y=40:w=48:h=48:color=0x884422:t=fill",
    "-frames:v",
    "1",
    "-c:v",
    "png",
    "-f",
    "image2pipe",
    "pipe:1",
  ]);
  // The swap style's own scene: a different size and colour from the house one.
  swapScene.buffer = ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0xCCDDEE:s=96x96:d=1",
    "-frames:v",
    "1",
    "-c:v",
    "png",
    "-f",
    "image2pipe",
    "pipe:1",
  ]);
  // One second of a square sliding over a background that has drifted dark,
  // shaped like Seedance's answer: 960 px square, 24 fps.
  const clip = path.join(scratch, "clip.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0xE0E0E0:s=960x960:d=1:r=24",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x884422:s=100x100:d=1:r=24",
    "-filter_complex",
    "[0][1]overlay=x='t*600':y=400:eval=frame",
    // H.264 in MP4, as Seedance returns it.
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clip,
  ]);
  fixtureClip = readFileSync(clip);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// ---- the fake provider and the world around it ----

let pollsBeforeDone = 1;
let operations: string[] = [];

function resetWorld() {
  vi.clearAllMocks();
  avatars.reset();
  renders.reset();
  blobFiles.clear();
  blobTypes.clear();
  bots.avatarImageUrl = null;
  deletedBots.clear();
  operations = [];
  getEnvMock.mockReturnValue({
    AI_GATEWAY_API_KEY: "gw-test",
    BLOB_READ_WRITE_TOKEN: "token",
  });
  providerMock.editImage.mockImplementation(async () => fixturePng);
  providerMock.rewrite.mockResolvedValue({ edit: "", note: "" });
  providerMock.startVideo.mockImplementation(async () => {
    operations.push(`op-${operations.length + 1}`);
    return { job: operations.at(-1) };
  });
  const polled = new Map<string, number>();
  providerMock.pollVideo.mockImplementation(async (op: { job: string }) => {
    const seen = (polled.get(op.job) ?? 0) + 1;
    polled.set(op.job, seen);
    return seen > pollsBeforeDone
      ? { status: "completed", video: fixtureClip }
      : { status: "pending" };
  });
  // Blob URLs are served from memory, as `downloadAvatarAsset` fetches them.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const file = blobFiles.get(url);
      return file
        ? { ok: true, arrayBuffer: async () => new Uint8Array(file).buffer }
        : { ok: false, status: 404 };
    }),
  );
  pollsBeforeDone = 1;
}

beforeEach(resetWorld);
afterEach(() => {
  vi.unstubAllGlobals();
  delete AVATAR_STYLES["swap-test"];
});

async function keptLook(
  change: Parameters<typeof createAvatarDraft>[0]["change"],
  style?: SokoBotAvatarStyle,
) {
  const result = await createAvatarDraft({
    sokoBotId: BOT,
    userId: USER,
    change,
    style,
  });
  await keepAvatarDraft({
    sokoBotId: BOT,
    draftId: result.draft!.id,
    userId: USER,
  });
  return result.draft!;
}

/** Cron ticks until nothing is left to do, bounded. */
async function reconcileUntilSettled(maxTicks = 12) {
  for (let i = 0; i < maxTicks; i += 1) {
    await reconcileAvatarRenders();
    const live = renders.rows.filter((row) =>
      [
        "PENDING",
        "STILL_READY",
        "VIDEO_SUBMITTING",
        "VIDEO_SUBMITTED",
      ].includes(row.status as string),
    );
    if (live.length === 0) return i + 1;
  }
  throw new Error("renders never settled");
}

describe("levels", () => {
  it("lands the background on the style's target, within 0.85-1.3", async () => {
    const leveled = await levelStill(fixturePng, 245);

    // WebP is lossy, so the flat background may move a level or two.
    const [r, g, b] = await pixel(leveled, 2, 2);
    for (const channel of [r, g, b]) {
      expect(Math.abs(channel! - 245)).toBeLessThanOrEqual(2);
    }
    expect(webpInfo(leveled)).toEqual({ width: 1024, height: 1024 });
  });

  it("clamps the correction instead of chasing a far-off background", async () => {
    // 0xEB (235) toward 100 would need 0.43; the clamp stops at 0.85.
    const leveled = await levelStill(fixturePng, 100);

    expect(
      Math.abs((await pixel(leveled, 2, 2))[0]! - 235 * 0.85),
    ).toBeLessThanOrEqual(4);
  });
});

describe("drafting", () => {
  it("draws a creature swap from the house scene, under the house prompt", async () => {
    const { draft, note } = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "creature", creature: "otter" },
    });

    expect(note).toBe("");
    expect(providerMock.editImage).toHaveBeenCalledTimes(1);
    const call = providerMock.editImage.mock.calls[0]?.[0];
    expect(call.system).toBe(CRAFTED_DESK_STYLE.housePrompt);
    expect(call.prompt).toContain("brown otter with chocolate fur");
    expect(call.reference.length).toBeGreaterThan(1_000);
    // The draft is an unclaimed row tied to the bot, with an expiry.
    expect(draft).toMatchObject({
      look: { creature: "otter", accessories: [], typed: [] },
    });
    expect(avatars.rows).toHaveLength(1);
    expect(avatars.rows[0]).toMatchObject({
      claimedBySokoBotId: null,
      draftForSokoBotId: BOT,
      reservedAt: null,
      styleId: "crafted-desk",
      requestedByUserId: USER,
    });
    const stored = blobFiles.get(draft!.imageUrl)!;
    expect(webpInfo(stored).width).toBe(1024);
    // And it came back levelled to #F5F5F5.
    expect(Math.abs((await pixel(stored, 2, 2))[0]! - 245)).toBeLessThanOrEqual(
      1,
    );
    expect(bots.avatarImageUrl).toBeNull();
  });

  it("stacks accessories on the draft being edited", async () => {
    const first = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "accessory", accessory: "glasses", enabled: true },
    });
    const second = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "accessory", accessory: "scarf", enabled: true },
      draftId: first.draft!.id,
    });

    expect(second.draft?.look.accessories).toEqual(["glasses", "scarf"]);
    // The second edit started from the first draft's image, not the house scene.
    const reference = providerMock.editImage.mock.calls[1]?.[0].reference;
    expect(reference).toEqual(blobFiles.get(first.draft!.imageUrl));
    expect(providerMock.editImage.mock.calls[1]?.[0].prompt).toContain(
      "cream and green striped knitted scarf",
    );
    expect(avatars.rows[1]).toMatchObject({ parentAvatarId: first.draft!.id });
  });

  it("sends a typed change through the rewriter and edits with what it returns", async () => {
    providerMock.rewrite.mockResolvedValue({
      edit: "Give the owl a tiny wizard hat with stars.",
      note: "Made the hat a clay one.",
    });

    const result = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "typed", text: "give him a wizard hat" },
    });

    expect(providerMock.rewrite).toHaveBeenCalledWith({
      rules: expect.stringContaining("You do not edit the image."),
      request: "give him a wizard hat",
    });
    expect(providerMock.editImage.mock.calls[0]?.[0].prompt).toBe(
      "Give the owl a tiny wizard hat with stars.",
    );
    expect(result.note).toBe("Made the hat a clay one.");
    expect(result.draft?.look.typed).toEqual([
      "Give the owl a tiny wizard hat with stars.",
    ]);
  });

  it("answers a refusal with the note, no image call and no new row", async () => {
    providerMock.rewrite.mockResolvedValue({
      edit: "",
      note: "I can't draw that. How about a tiny sailor hat?",
    });

    const result = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "typed", text: "make him a famous cartoon mouse" },
    });

    expect(result).toEqual({
      draft: null,
      note: "I can't draw that. How about a tiny sailor hat?",
    });
    expect(providerMock.editImage).not.toHaveBeenCalled();
    expect(avatars.rows).toHaveLength(0);
  });

  it("says why when the rewriter refuses without a note", async () => {
    providerMock.rewrite.mockResolvedValue({ edit: "", note: "" });

    const result = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "typed", text: "a famous logo" },
    });

    expect(result.draft).toBeNull();
    expect(result.note).not.toBe("");
  });

  it("answers 503, having spent nothing, when the rewriter is down", async () => {
    providerMock.rewrite.mockRejectedValue(new Error("gateway down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "typed", text: "a wizard hat" },
      }),
    ).rejects.toMatchObject({ status: 503 });

    warn.mockRestore();
    expect(providerMock.editImage).not.toHaveBeenCalled();
    expect(avatars.rows).toHaveLength(0);
  });

  it("shuffles from the house scene whatever the bot looks like now", async () => {
    await keptLook({ kind: "creature", creature: "frog" });
    providerMock.editImage.mockClear();

    const { draft } = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "shuffle" },
    });

    expect(draft).not.toBeNull();
    expect(providerMock.editImage).toHaveBeenCalledTimes(1);
    expect(draft?.look.typed).toEqual([]);
  });

  describe("shuffle", () => {
    function poolLook(overrides: Record<string, unknown> = {}) {
      return avatars.create({
        data: {
          subject: "frog",
          background: "crafted-desk:none",
          seed: Math.floor(Math.random() * 1e6),
          model: "m",
          imageUrl: "https://blob.test/pool-look.webp",
          styleId: "crafted-desk",
          styleVersion: 1,
          fromPool: true,
          look: { creature: "frog", accessories: [], typed: [] },
          ...overrides,
        },
      });
    }

    it("takes an unclaimed pool look as the draft, and spends nothing", async () => {
      const pooled = await poolLook();

      const { draft } = await createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "shuffle" },
      });

      expect(draft).toMatchObject({
        id: pooled.id,
        imageUrl: "https://blob.test/pool-look.webp",
        look: { creature: "frog" },
      });
      expect(providerMock.editImage).not.toHaveBeenCalled();
      expect(providerMock.rewrite).not.toHaveBeenCalled();
      expect(pooled).toMatchObject({
        draftForSokoBotId: BOT,
        draftExpiresAt: expect.any(Date),
        claimedBySokoBotId: null,
      });
    });

    it("never takes a legacy mascot or another bot's draft from the pool", async () => {
      await poolLook({ styleId: "mascot" });
      await poolLook({ draftForSokoBotId: "bot-2" });

      const { draft } = await createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "shuffle" },
      });

      // Nothing eligible, so it drew a fresh look.
      expect(providerMock.editImage).toHaveBeenCalledTimes(1);
      expect(draft?.id).not.toBeUndefined();
    });

    it("sends a never-kept pool look back to the pool when the draft expires, and deletes a drawn one", async () => {
      const pooled = await poolLook();
      await createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "shuffle" },
      });
      const drawn = await createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "creature", creature: "frog" },
      });
      for (const row of avatars.rows) {
        row.draftExpiresAt = new Date(Date.now() - 1_000);
      }

      await sweepExpiredDrafts();

      expect(avatars.rows.map((row) => row.id)).toEqual([pooled.id]);
      expect(pooled).toMatchObject({
        draftForSokoBotId: null,
        draftExpiresAt: null,
      });
      expect(avatars.rows.some((row) => row.id === drawn.draft?.id)).toBe(
        false,
      );
    });

    it("keeping a pool look releases the bot's other pool draft instead of deleting it", async () => {
      const other = await poolLook({
        draftForSokoBotId: BOT,
        draftExpiresAt: new Date(Date.now() + 60_000),
      });
      const kept = await poolLook({
        draftForSokoBotId: BOT,
        draftExpiresAt: new Date(Date.now() + 60_000),
      });

      await keepAvatarDraft({
        sokoBotId: BOT,
        draftId: kept.id as string,
        userId: USER,
      });

      expect(avatars.rows).toContain(other);
      expect(other).toMatchObject({ draftForSokoBotId: null });
      expect(kept).toMatchObject({ claimedBySokoBotId: BOT });
    });
  });

  it("stops at the hourly draft cap before spending", async () => {
    for (let i = 0; i < LIMITS.SOKO_BOT_AVATAR_DRAFTS_PER_HOUR; i += 1) {
      await avatars.create({
        data: {
          subject: "owl",
          background: "x",
          seed: i,
          model: "m",
          imageUrl: "u",
          requestedByUserId: USER,
          draftForSokoBotId: BOT,
        },
      });
    }

    await expect(
      createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "creature", creature: "frog" },
      }),
    ).rejects.toMatchObject({ status: 429 });

    expect(providerMock.editImage).not.toHaveBeenCalled();
    expect(avatars.rows).toHaveLength(LIMITS.SOKO_BOT_AVATAR_DRAFTS_PER_HOUR);
  });

  it("gives the slot back when the provider fails", async () => {
    providerMock.editImage.mockRejectedValue(new Error("provider down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "creature", creature: "frog" },
      }),
    ).rejects.toMatchObject({ status: 503 });

    warn.mockRestore();
    expect(avatars.rows).toHaveLength(0);
  });

  it("treats a creature the style does not have as a bad request", async () => {
    await expect(
      createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "creature", creature: "unicorn" },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(providerMock.editImage).not.toHaveBeenCalled();
  });
});

describe("keeping a look", () => {
  it("claims the draft and creates one render row per state", async () => {
    const draft = await keptLook({ kind: "creature", creature: "hedgehog" });

    expect(bots.avatarImageUrl).toBe(draft.imageUrl);
    expect(renders.rows.map((row) => row.state).sort()).toEqual(
      ["DONE", "IDLE", "NEEDS_YOU", "OFFLINE", "THINKING", "WORKING"].sort(),
    );
    const idle = renders.rows.find((row) => row.state === "IDLE");
    expect(idle).toMatchObject({
      status: "STILL_READY",
      stillUrl: draft.imageUrl,
    });
    expect(renders.rows.filter((row) => row.status === "PENDING")).toHaveLength(
      5,
    );
    expect(avatars.rows[0]).toMatchObject({
      claimedBySokoBotId: BOT,
      keptByUserId: USER,
      keptAt: expect.any(Date),
    });
  });

  it("retires the look a bot replaces: renders gone, a tombstone for the cap, never claimable again", async () => {
    const first = await keptLook({ kind: "creature", creature: "frog" });
    const second = await keptLook({ kind: "creature", creature: "otter" });

    const firstRow = avatars.rows.find((row) => row.id === first.id)!;
    expect(firstRow).toMatchObject({
      claimedBySokoBotId: null,
      keptByUserId: USER,
      draftForSokoBotId: BOT,
      draftExpiresAt: expect.any(Date),
    });
    // Only the new look has renders.
    expect(new Set(renders.rows.map((row) => row.avatarId))).toEqual(
      new Set([second.id]),
    );
    expect(renders.rows).toHaveLength(6);
    // No free undo.
    await expect(
      keepAvatarDraft({ sokoBotId: BOT, draftId: first.id, userId: USER }),
    ).rejects.toMatchObject({ status: 404 });
    // And the tombstone still counts toward the daily cap until it is swept.
    expect(
      avatars.rows.filter((row) => row.keptByUserId === USER),
    ).toHaveLength(2);
  });

  it("will not keep a draft that belongs to another bot", async () => {
    const { draft } = await createAvatarDraft({
      sokoBotId: "bot-2",
      userId: USER,
      change: { kind: "creature", creature: "frog" },
    });

    await expect(
      keepAvatarDraft({ sokoBotId: BOT, draftId: draft!.id, userId: USER }),
    ).rejects.toMatchObject({ status: 404 });
    expect(renders.rows).toHaveLength(0);
  });

  it("stops at the daily keep cap", async () => {
    for (let i = 0; i < LIMITS.SOKO_BOT_AVATAR_KEEPS_PER_DAY; i += 1) {
      await avatars.create({
        data: {
          subject: "owl",
          background: "x",
          seed: 1_000 + i,
          model: "m",
          imageUrl: "u",
          keptByUserId: USER,
          keptAt: new Date(),
          claimedBySokoBotId: `other-${i}`,
        },
      });
    }
    const { draft } = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "creature", creature: "frog" },
    });

    await expect(
      keepAvatarDraft({ sokoBotId: BOT, draftId: draft!.id, userId: USER }),
    ).rejects.toMatchObject({ status: 429 });
    expect(renders.rows).toHaveLength(0);
  });
});

describe("reconciling renders", () => {
  it("walks every state to READY with a still and two MP4 loops", async () => {
    const draft = await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();

    await reconcileUntilSettled();

    expect(renders.rows.map((row) => row.status)).toEqual(
      Array(6).fill("READY"),
    );
    // Five stills are drawn (the idle still is the look itself), six loops are
    // bought, and nothing is bought twice.
    expect(providerMock.editImage).toHaveBeenCalledTimes(5);
    expect(providerMock.startVideo).toHaveBeenCalledTimes(6);
    const stillPrompts = providerMock.editImage.mock.calls.map(
      (call) => call[0].prompt as string,
    );
    expect(stillPrompts.some((p) => p.includes("raises one hand high"))).toBe(
      true,
    );
    for (const call of providerMock.editImage.mock.calls) {
      // Every state edits the kept look, and the framing is pinned.
      expect(call[0].reference).toEqual(blobFiles.get(draft.imageUrl));
      expect(call[0].prompt).toContain("otter");
      expect(call[0].prompt).toContain("same framing and zoom");
    }
    // The loop starts from the hosted still, as first and last frame.
    for (const call of providerMock.startVideo.mock.calls) {
      expect(call[0].imageUrl).toMatch(/^https:\/\/blob\.test\//);
      expect(blobFiles.has(call[0].imageUrl)).toBe(true);
    }
    for (const row of renders.rows) {
      const small = blobFiles.get(row.loopUrl as string)!;
      const large = blobFiles.get(row.loopLargeUrl as string)!;
      // H.264 High in MP4, muted, at the source's 24 fps, index first.
      for (const [file, side] of [
        [small, 480],
        [large, 960],
      ] as const) {
        expect(mp4Info(file)).toEqual({
          codec: "h264",
          profile: "High",
          width: side,
          height: side,
          fps: 24,
          hasAudio: false,
          pixelFormat: "yuv420p",
          indexFirst: true,
        });
      }
      // Loops are colour-corrected to the state's background.
      const target = row.state === "OFFLINE" ? 215 : 245;
      expect(Math.abs(mp4Corner(small) - target)).toBeLessThanOrEqual(3);
      expect(Math.abs(mp4Corner(large) - target)).toBeLessThanOrEqual(3);
      for (const url of [row.loopUrl, row.loopLargeUrl] as string[]) {
        expect(url).toMatch(/\.mp4$/);
        expect(blobTypes.get(url)).toBe("video/mp4");
      }
      expect(blobTypes.get(row.stillUrl as string)).toBe("image/webp");
    }
    // The still of a dimmer state lands on its own, darker background.
    const offline = renders.rows.find((row) => row.state === "OFFLINE")!;
    expect(
      Math.abs(
        (await pixel(blobFiles.get(offline.stillUrl as string)!, 2, 2))[0]! -
          215,
      ),
    ).toBeLessThanOrEqual(1);
  }, 120_000);

  it("collects a loop on a later tick, never waiting on the video", async () => {
    pollsBeforeDone = 3;
    await keptLook({ kind: "creature", creature: "otter" });

    const first = await reconcileAvatarRenders();

    // One tick submits; it does not sit on the provider until the video is done.
    expect(first.finished).toBe(0);
    expect(
      renders.rows.filter((row) => row.status === "VIDEO_SUBMITTED").length,
    ).toBeGreaterThan(0);
  });

  it("retries a failing still, then stops at FAILED without blocking the rest", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    providerMock.editImage.mockImplementation(
      async (input: { prompt: string }) => {
        if (input.prompt.includes("asleep")) throw new Error("provider down");
        return fixturePng;
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await reconcileUntilSettled();
    warn.mockRestore();

    const byState = Object.fromEntries(
      renders.rows.map((row) => [row.state, row.status]),
    );
    expect(byState.OFFLINE).toBe("FAILED");
    expect(
      Object.entries(byState).filter(([state]) => state !== "OFFLINE"),
    ).toSatisfy((rows: [string, unknown][]) =>
      rows.every(([, status]) => status === "READY"),
    );
    const offlineTries = providerMock.editImage.mock.calls.filter((call) =>
      call[0].prompt.includes("asleep"),
    );
    expect(offlineTries).toHaveLength(MAX_RENDER_ATTEMPTS);
    // The bot keeps its look: a failed state only means no animation.
    expect(bots.avatarImageUrl).not.toBeNull();
  }, 120_000);

  describe("a video whose submission is uncertain", () => {
    const WORKING_PROMPT = "reads, its eyes move";

    function workingRow() {
      return renders.rows.find((row) => row.state === "WORKING")!;
    }

    function workingSubmits() {
      return providerMock.startVideo.mock.calls.filter((call) =>
        call[0].prompt.includes(WORKING_PROMPT),
      );
    }

    async function keepWithUncertainWorking() {
      await keptLook({ kind: "creature", creature: "otter" });
      providerMock.startVideo.mockImplementation(
        async (input: { prompt: string }) => {
          if (input.prompt.includes(WORKING_PROMPT)) {
            throw new VideoSubmissionUncertainError("socket hang up");
          }
          return { job: "ok" };
        },
      );
    }

    it("is left alone while it may still be running, with its still intact", async () => {
      await keepWithUncertainWorking();

      await reconcileUntilSettled();
      await reconcileAvatarRenders();
      await reconcileAvatarRenders();

      expect(workingRow().status).toBe("SUBMISSION_UNCERTAIN");
      expect(workingRow().stillUrl).toBeTruthy();
      expect(workingSubmits()).toHaveLength(1);
      // Not eligible again for half an hour.
      expect(
        (workingRow().leaseUntil as Date).getTime() - Date.now(),
      ).toBeGreaterThan(UNCERTAIN_WAIT_MS - 60_000);
    });

    it("is submitted again after the wait, with the same key, and counts as an attempt", async () => {
      await keepWithUncertainWorking();
      await reconcileUntilSettled();
      const attemptsBefore = workingRow().attempts as number;
      providerMock.startVideo.mockImplementation(async () => ({ job: "ok" }));
      workingRow().leaseUntil = new Date(Date.now() - 1_000);

      await reconcileAvatarRenders();

      expect(workingSubmits()).toHaveLength(2);
      const [first, second] = workingSubmits().map(
        (call) => call[0].idempotencyKey,
      );
      expect(first).toBe(second);
      expect(first).toContain(workingRow().avatarId);
      expect(workingRow().attempts).toBe(attemptsBefore + 1);
      expect(workingRow().status).toBe("VIDEO_SUBMITTED");
    });

    it("keeps its key on the row while the submit is unanswered, and drops it on a new job", async () => {
      await keepWithUncertainWorking();
      await reconcileUntilSettled();

      expect(workingRow().providerOperation).toEqual({
        submissionKey: workingSubmits()[0]?.[0].idempotencyKey,
      });
    });

    it("still ends in FAILED after the attempt budget, never submitting more than that", async () => {
      await keepWithUncertainWorking();
      await reconcileUntilSettled();

      for (let i = 0; i < MAX_RENDER_ATTEMPTS + 2; i += 1) {
        workingRow().leaseUntil = new Date(Date.now() - 1_000);
        await reconcileAvatarRenders();
      }

      expect(workingRow().status).toBe("FAILED");
      expect(workingSubmits()).toHaveLength(MAX_RENDER_ATTEMPTS);
    });

    it("is what a submit whose lease ran out becomes, not a resubmit", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      const row = renders.rows.find((one) => one.state === "IDLE")!;
      // A worker died after claiming the submit and before hearing back.
      Object.assign(row, {
        status: "VIDEO_SUBMITTING",
        leaseUntil: new Date(Date.now() - 1_000),
      });
      providerMock.editImage.mockImplementation(async () => {
        throw new Error("stills are not under test");
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await reconcileAvatarRenders();
      await reconcileAvatarRenders();

      expect(row.status).toBe("SUBMISSION_UNCERTAIN");
      expect((row.leaseUntil as Date).getTime() - Date.now()).toBeGreaterThan(
        UNCERTAIN_WAIT_MS - 60_000,
      );
      expect(providerMock.startVideo).not.toHaveBeenCalled();
    });
  });

  describe("the idempotency key of a video submit", () => {
    const keysOf = (state: string) =>
      providerMock.startVideo.mock.calls
        .filter((call) => call[0].prompt.includes(state))
        .map((call) => call[0].idempotencyKey as string);
    const WORKING = "reads, its eyes move";
    const workingRow = () =>
      renders.rows.find((row) => row.state === "WORKING")!;

    it("is new for each submit after a definite failure: a refusal", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      let refused = false;
      providerMock.startVideo.mockImplementation(
        async (input: { prompt: string }) => {
          if (input.prompt.includes(WORKING) && !refused) {
            refused = true;
            throw new Error("the parameter resolution is not valid");
          }
          return { job: "ok" };
        },
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await reconcileUntilSettled();

      const [first, second] = keysOf(WORKING);
      expect(keysOf(WORKING)).toHaveLength(2);
      expect(second).not.toBe(first);
      expect(workingRow().status).toBe("READY");
    });

    it("is new for each submit after the job itself failed", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      let failed = false;
      providerMock.pollVideo.mockImplementation(async (op: { job: string }) => {
        if (op.job === "bad" && !failed) {
          failed = true;
          return { status: "failed", reason: "invalid parameter" };
        }
        return { status: "completed", video: fixtureClip };
      });
      providerMock.startVideo.mockImplementation(
        async (input: { prompt: string }) => ({
          job: input.prompt.includes(WORKING) ? "bad" : "ok",
        }),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await reconcileUntilSettled();

      const [first, second] = keysOf(WORKING);
      expect(keysOf(WORKING)).toHaveLength(2);
      expect(second).not.toBe(first);
      expect(workingRow().status).toBe("READY");
    });

    it("is the same after an uncertain submit, so a repeat is the same job", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      let uncertain = false;
      providerMock.startVideo.mockImplementation(
        async (input: { prompt: string }) => {
          if (input.prompt.includes(WORKING) && !uncertain) {
            uncertain = true;
            throw new VideoSubmissionUncertainError("socket hang up");
          }
          return { job: "ok" };
        },
      );
      await reconcileUntilSettled();
      workingRow().leaseUntil = new Date(Date.now() - 1_000);
      await reconcileAvatarRenders();

      const [first, second] = keysOf(WORKING);
      expect(keysOf(WORKING)).toHaveLength(2);
      expect(second).toBe(first);
    });

    it("clears from the row on a definite failure", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      providerMock.startVideo.mockRejectedValue(new Error("refused"));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await reconcileAvatarRenders();
      await reconcileAvatarRenders();

      expect(workingRow().providerOperation).toBeNull();
    });

    it("hands the poll the Gateway's operation, whole, not the wrapper around it", async () => {
      await keptLook({ kind: "creature", creature: "otter" });

      await reconcileUntilSettled();

      for (const [operation] of providerMock.pollVideo.mock.calls) {
        expect(operation).toEqual({ job: expect.stringMatching(/^op-/) });
      }
      expect(workingRow().providerOperation).toEqual({
        submissionKey: expect.stringContaining(":working:"),
        operation: { job: expect.stringMatching(/^op-/) },
      });
    });

    it("still polls a row stored before the key travelled with it", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      await reconcileAvatarRenders();
      Object.assign(workingRow(), {
        status: "VIDEO_SUBMITTED",
        providerOperation: { job: "bare" },
        submittedAt: new Date(),
        leaseUntil: null,
      });
      providerMock.pollVideo.mockClear();

      await reconcileAvatarRenders();

      expect(providerMock.pollVideo).toHaveBeenCalledWith({ job: "bare" });
    });
  });

  it("does not reclaim a slow step's row while its worker is still on it", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    // The first tick's three workers are slow; whatever a later tick draws is not.
    const release: (() => void)[] = [];
    providerMock.editImage.mockImplementation(() =>
      release.length < 3
        ? new Promise<Buffer>((resolve) => {
            release.push(() => resolve(fixturePng));
          })
        : Promise.resolve(fixturePng),
    );
    // Only the clock moves; ffmpeg and timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const slow = reconcileAvatarRenders();
      await vi.waitFor(() =>
        expect(providerMock.editImage).toHaveBeenCalledTimes(3),
      );

      // Seven minutes into the slowest legitimate step, a second tick starts.
      vi.setSystemTime(Date.now() + 7 * 60_000);
      await reconcileAvatarRenders();

      // The rows being worked were not reclaimed: no state was drawn twice,
      // and the second tick only drew the two states nobody had started.
      const prompts = providerMock.editImage.mock.calls.map(
        (call) => call[0].prompt,
      );
      expect(prompts).toHaveLength(5);
      expect(new Set(prompts).size).toBe(5);
      for (const resolve of release.splice(0)) resolve();
      await slow;
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("lets a lease stop a second cron from working the same row", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    providerMock.editImage.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fixturePng;
    });

    // Two crons start together and both read the same pending rows.
    await Promise.all([reconcileAvatarRenders(), reconcileAvatarRenders()]);

    // Five states to draw, and each was drawn once.
    expect(providerMock.editImage).toHaveBeenCalledTimes(5);
  }, 60_000);

  it("leaves a row that another worker holds", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    for (const row of renders.rows) {
      row.leaseUntil = new Date(Date.now() + 60_000);
    }

    await reconcileAvatarRenders();

    expect(providerMock.editImage).not.toHaveBeenCalled();
    expect(providerMock.startVideo).not.toHaveBeenCalled();
  });

  it("does not spend on a look the bot no longer holds", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    avatars.rows[0]!.claimedBySokoBotId = null;

    await reconcileAvatarRenders();

    expect(providerMock.editImage).not.toHaveBeenCalled();
    expect(providerMock.startVideo).not.toHaveBeenCalled();
  });

  it("does not spend on a bot that has been deleted", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    deletedBots.add(BOT);

    await reconcileAvatarRenders();

    expect(providerMock.editImage).not.toHaveBeenCalled();
    expect(providerMock.startVideo).not.toHaveBeenCalled();
  });

  it("keeps collecting a loop whose download fails, without resubmitting it", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    await reconcileAvatarRenders();
    await reconcileAvatarRenders();
    providerMock.pollVideo.mockRejectedValue(new Error("download failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const submitted = providerMock.startVideo.mock.calls.length;

    await reconcileAvatarRenders();
    await reconcileAvatarRenders();

    expect(providerMock.startVideo).toHaveBeenCalledTimes(submitted);
    expect(
      renders.rows.filter((row) => row.status === "VIDEO_SUBMITTED").length,
    ).toBeGreaterThan(0);
  });
});

describe("keeping a run inside the function's time limit", () => {
  /** Kept look whose six loops are all submitted and none ready yet. */
  async function allSubmitted() {
    pollsBeforeDone = 1_000_000;
    await keptLook({ kind: "creature", creature: "otter" });
    for (let tick = 0; tick < 6; tick += 1) {
      await reconcileAvatarRenders();
      if (renders.rows.every((row) => row.status === "VIDEO_SUBMITTED")) break;
    }
    expect(renders.rows.map((row) => row.status)).toEqual(
      Array(6).fill("VIDEO_SUBMITTED"),
    );
    pollsBeforeDone = 0;
    providerMock.pollVideo.mockClear();
  }

  it("starts no collect with too little time left, and leaves the row untouched", async () => {
    await allSubmitted();
    const before = renders.rows.map((row) => ({ ...row }));

    const result = await reconcileAvatarRenders({
      msRemaining: () => COLLECT_MIN_BUDGET_MS - 1,
    });

    expect(result.finished).toBe(0);
    expect(providerMock.pollVideo).not.toHaveBeenCalled();
    // No lease taken, no attempt counted, nothing rewritten.
    expect(renders.rows.map((row) => ({ ...row }))).toEqual(before);
  });

  it("starts no still with too little time left either, leaving its row for the next run", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    const pending = renders.rows.filter((row) => row.status === "PENDING");

    await reconcileAvatarRenders({
      msRemaining: () => STILL_MIN_BUDGET_MS - 1,
    });

    expect(providerMock.editImage).not.toHaveBeenCalled();
    for (const row of pending) {
      expect(row).toMatchObject({
        status: "PENDING",
        attempts: 0,
        leaseUntil: null,
      });
    }
  });

  it("does a still with enough time for one but not for a collect", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();

    await reconcileAvatarRenders({
      msRemaining: () => COLLECT_MIN_BUDGET_MS - 1,
    });

    expect(providerMock.editImage).toHaveBeenCalledTimes(5);
  });

  it("checks the time when a step is about to start, not when it was queued", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.editImage.mockClear();
    // Plenty of time for the first three stills, then the clock runs out.
    let left = 10 * 60_000;
    providerMock.editImage.mockImplementation(async () => {
      left = 0;
      return fixturePng;
    });

    await reconcileAvatarRenders({ msRemaining: () => left });

    // Those already running (at most three at a time, the idle loop's submit
    // among them) finished; the ones queued behind them saw no time left and
    // were left whole.
    const started = providerMock.editImage.mock.calls.length;
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThanOrEqual(3);
    const waiting = renders.rows.filter((row) => row.status === "PENDING");
    expect(waiting).toHaveLength(5 - started);
    for (const row of waiting) {
      expect(row).toMatchObject({ attempts: 0, leaseUntil: null });
    }
  });

  it("collects at most two loops a run, one at a time", async () => {
    await allSubmitted();
    let inFlight = 0;
    let mostAtOnce = 0;
    providerMock.pollVideo.mockImplementation(async () => {
      inFlight += 1;
      mostAtOnce = Math.max(mostAtOnce, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return { status: "completed", video: fixtureClip };
    });

    const first = await reconcileAvatarRenders();

    expect(first.finished).toBe(MAX_COLLECTS_PER_RUN);
    expect(mostAtOnce).toBe(1);
    expect(renders.rows.filter((row) => row.status === "READY")).toHaveLength(
      2,
    );
    // The rest were not started: no lease, no poll beyond the two.
    expect(providerMock.pollVideo).toHaveBeenCalledTimes(2);
    for (const row of renders.rows.filter((one) => one.status !== "READY")) {
      expect(row).toMatchObject({
        status: "VIDEO_SUBMITTED",
        leaseUntil: null,
      });
    }

    await reconcileAvatarRenders();
    await reconcileAvatarRenders();
    expect(renders.rows.map((row) => row.status)).toEqual(
      Array(6).fill("READY"),
    );
  }, 120_000);

  it("does not spend a collect slot on a clip that is not ready yet", async () => {
    await allSubmitted();
    // Four are still rendering, two are done: both done ones get collected.
    const done = new Set(renders.rows.slice(-2).map((row) => row.id));
    providerMock.pollVideo.mockImplementation(async (op: { job: string }) => {
      const row = renders.rows.find(
        (one) =>
          (one.providerOperation as { operation: { job: string } }).operation
            .job === op.job,
      );
      return row && done.has(row.id as string)
        ? { status: "completed", video: fixtureClip }
        : { status: "pending" };
    });

    const result = await reconcileAvatarRenders();

    expect(result.finished).toBe(2);
  }, 120_000);

  it("logs how long each collect and each still took, step by step", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await keptLook({ kind: "creature", creature: "otter" });

    await reconcileUntilSettled();

    const logged = info.mock.calls.map((call) => call[1]);
    const numbers = expect.any(Number);
    expect(logged).toContainEqual({
      kind: "avatar_render_still",
      state: expect.any(String),
      editMs: numbers,
      levelMs: numbers,
      uploadMs: numbers,
    });
    expect(logged).toContainEqual({
      kind: "avatar_render_collect",
      state: expect.any(String),
      downloadMs: numbers,
      ffmpegReadyMs: numbers,
      encodeMs: numbers,
      uploadMs: numbers,
      totalMs: numbers,
    });
    expect(
      logged.filter((entry) => entry?.kind === "avatar_render_collect"),
    ).toHaveLength(6);
    info.mockRestore();
  });
});

describe("cancelling drafts", () => {
  const draftOf = async (sokoBotId: string, creature = "frog") =>
    (
      await createAvatarDraft({
        sokoBotId,
        userId: USER,
        change: { kind: "creature", creature },
      })
    ).draft!;

  function poolDraft(sokoBotId: string) {
    return avatars.create({
      data: {
        subject: "x",
        background: `b-${sokoBotId}`,
        seed: Math.floor(Math.random() * 1e9),
        model: "m",
        imageUrl: "https://blob.test/pool.webp",
        styleId: "crafted-desk",
        styleVersion: 1,
        fromPool: true,
        traitKey: `key-${sokoBotId}`,
        draftForSokoBotId: sokoBotId,
        draftExpiresAt: new Date(Date.now() + 60_000),
        look: { creature: "frog", accessories: [], typed: [] },
      },
    });
  }

  it("deletes a draft drawn for the bot and leaves the kept look and its renders alone", async () => {
    const kept = await keptLook({ kind: "creature", creature: "otter" });
    const draft = await draftOf(BOT);
    const rendersBefore = renders.rows.length;

    await discardAvatarDrafts({ sokoBotId: BOT, draftId: draft.id });

    expect(avatars.rows.map((row) => row.id)).toEqual([kept.id]);
    expect(avatars.rows[0]).toMatchObject({ claimedBySokoBotId: BOT });
    expect(renders.rows).toHaveLength(rendersBefore);
    expect(bots.avatarImageUrl).toBe(kept.imageUrl);
  });

  it("sends a pool look back to the pool instead of deleting it", async () => {
    const pooled = await poolDraft(BOT);

    await discardAvatarDrafts({ sokoBotId: BOT, draftId: pooled.id as string });

    expect(avatars.rows).toContain(pooled);
    expect(pooled).toMatchObject({
      draftForSokoBotId: null,
      draftExpiresAt: null,
      fromPool: true,
    });
  });

  it("clears a whole chain of edits in one go, pool and drawn alike", async () => {
    const kept = await keptLook({ kind: "creature", creature: "otter" });
    const pooled = await poolDraft(BOT);
    const first = await draftOf(BOT);
    await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "accessory", accessory: "scarf", enabled: true },
      draftId: first.id,
    });

    await discardAvatarDrafts({ sokoBotId: BOT });

    expect(avatars.rows.map((row) => row.id).sort()).toEqual(
      [kept.id, pooled.id].sort(),
    );
    expect(pooled).toMatchObject({ draftForSokoBotId: null });
    expect((await getOpenDrafts(BOT)).length).toBe(0);
  });

  it("never touches another bot's drafts, nor a named draft that is not this bot's", async () => {
    const mine = await draftOf(BOT);
    const theirs = await draftOf("bot-2", "penguin");

    await discardAvatarDrafts({ sokoBotId: BOT, draftId: theirs.id });
    expect(avatars.rows.map((row) => row.id)).toContain(theirs.id);

    await discardAvatarDrafts({ sokoBotId: BOT });

    expect(avatars.rows.map((row) => row.id)).toEqual([theirs.id]);
    expect(avatars.rows.some((row) => row.id === mine.id)).toBe(false);
  });

  it("leaves the tombstone of a replaced look and a draft still being drawn", async () => {
    const old = await keptLook({ kind: "creature", creature: "frog" });
    await keptLook({ kind: "creature", creature: "otter" });
    const drawing = await avatars.create({
      data: {
        subject: "x",
        background: "drawing",
        seed: 1,
        model: "m",
        imageUrl: "",
        styleId: "crafted-desk",
        styleVersion: 1,
        draftForSokoBotId: BOT,
        draftExpiresAt: new Date(Date.now() + 60_000),
        reservedAt: new Date(),
      },
    });

    await discardAvatarDrafts({ sokoBotId: BOT });

    const ids = avatars.rows.map((row) => row.id);
    expect(ids).toContain(old.id);
    expect(ids).toContain(drawing.id);
  });

  it("is a no-op the second time, and for a draft that never existed", async () => {
    const draft = await draftOf(BOT);

    await discardAvatarDrafts({ sokoBotId: BOT, draftId: draft.id });
    await expect(
      discardAvatarDrafts({ sokoBotId: BOT, draftId: draft.id }),
    ).resolves.toBeUndefined();
    await expect(
      discardAvatarDrafts({ sokoBotId: BOT, draftId: "no-such-draft" }),
    ).resolves.toBeUndefined();
    await expect(
      discardAvatarDrafts({ sokoBotId: BOT }),
    ).resolves.toBeUndefined();
  });

  async function getOpenDrafts(sokoBotId: string) {
    return avatars.rows.filter(
      (row) =>
        row.draftForSokoBotId === sokoBotId &&
        row.claimedBySokoBotId === null &&
        row.keptAt === null,
    );
  }
});

describe("one of a kind", () => {
  const OTTER_KEY = "otter|chocolate|round-leaf|none|green-brown|none";

  function poolRow(traitKey: string, overrides: Record<string, unknown> = {}) {
    return avatars.create({
      data: {
        subject: "x",
        background: traitKey,
        seed: Math.floor(Math.random() * 1e9),
        model: "m",
        imageUrl: "https://blob.test/pool.webp",
        styleId: "crafted-desk",
        styleVersion: 1,
        fromPool: true,
        traitKey,
        look: { creature: "otter", accessories: [], typed: [] },
        ...overrides,
      },
    });
  }

  /** The look a seed makes, and its key. */
  const keyOfSeed = (seed: number) =>
    traitKeyOf(CRAFTED_DESK_STYLE, lookFromSeed(CRAFTED_DESK_STYLE, seed));

  /** Seeds come out in this order, then repeat the last. */
  function rollSeeds(...seeds: number[]) {
    let next = 0;
    return vi
      .spyOn(crypto, "randomInt")
      .mockImplementation(() => seeds[Math.min(next++, seeds.length - 1)]!);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws a pool look from its seed, with its traits, key and prompt", async () => {
    rollSeeds(4321);

    await generateAvatars(1);

    const row = avatars.rows[0]!;
    const expected = lookFromSeed(CRAFTED_DESK_STYLE, 4321);
    expect(row).toMatchObject({
      seed: 4321,
      look: expected,
      traitKey: traitKeyOf(CRAFTED_DESK_STYLE, expected),
    });
    const prompt = providerMock.editImage.mock.calls[0]?.[0].prompt as string;
    for (const [axisId, optionId] of Object.entries(expected.traits ?? {})) {
      const axis = CRAFTED_DESK_STYLE.traits.find((one) => one.id === axisId);
      const phrase =
        axis?.options.find((one) => one.id === optionId)?.phrase ??
        CRAFTED_DESK_STYLE.creatures
          .find((one) => one.id === expected.creature)
          ?.coats.find((one) => one.id === optionId)?.phrase;
      expect(prompt).toContain(phrase);
    }
  });

  it("skips a combination a pool or claimed look already has", async () => {
    const taken = keyOfSeed(111)!;
    await poolRow(taken);
    // The first roll lands on the taken key; every later one is free.
    rollSeeds(111, 222);

    await generateAvatars(1);

    expect(avatars.rows).toHaveLength(2);
    expect(avatars.rows[1]).toMatchObject({
      seed: 222,
      traitKey: keyOfSeed(222),
    });
  });

  it("gives two looks drawn together different keys", async () => {
    // The second slot rolls the first one's combination before a new one.
    rollSeeds(5, ...Array(11).fill(9), 5, 5, 9);

    await generateAvatars(2);

    const keys = avatars.rows.map((row) => row.traitKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("shuffles to a look nobody has, when it draws fresh", async () => {
    await poolRow(keyOfSeed(77)!, {
      fromPool: false,
      claimedBySokoBotId: "bot-9",
    });
    rollSeeds(77, 88);

    const { draft } = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "shuffle" },
    });

    expect(draft?.look).toEqual(lookFromSeed(CRAFTED_DESK_STYLE, 88));
    // A draft is not among the looks the key protects until it is kept.
    expect(avatars.rows.find((row) => row.id === draft?.id)).toMatchObject({
      seed: 88,
      traitKey: null,
    });
  });

  it("keeps the person's creature and re-rolls only the desk item and books when another bot has the combination", async () => {
    await poolRow(OTTER_KEY);

    const { draft } = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "creature", creature: "otter" },
    });

    const look = draft?.look;
    expect(look).toMatchObject({ creature: "otter", accessories: [] });
    expect(look?.traits).toMatchObject({
      coat: "chocolate",
      plant: "round-leaf",
    });
    expect(
      look?.traits?.deskItem !== "none" ||
        look?.traits?.books !== "green-brown",
    ).toBe(true);
    expect(traitKeyOf(CRAFTED_DESK_STYLE, look!)).not.toBe(OTTER_KEY);
    const prompt = providerMock.editImage.mock.calls[0]?.[0].prompt as string;
    expect(prompt).toContain("Also change these details of the scene:");
    expect(prompt).not.toContain("pink pot holds");
  });

  it("leaves the scene alone when the combination is free", async () => {
    const { draft } = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "creature", creature: "otter" },
    });

    expect(draft?.look.traits).toEqual({
      coat: "chocolate",
      plant: "round-leaf",
      deskItem: "none",
      books: "green-brown",
    });
    expect(providerMock.editImage.mock.calls[0]?.[0].prompt).not.toContain(
      "Also change",
    );
  });

  it("carries the look's traits through a swap, an accessory and a typed change", async () => {
    providerMock.rewrite.mockResolvedValue({
      edit: "Add a tiny flag.",
      note: "",
    });
    const first = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "shuffle" },
    });
    const traits = first.draft?.look.traits;
    const second = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "typed", text: "a flag" },
      draftId: first.draft?.id,
    });
    const third = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      // One it is not already wearing, whatever the shuffle drew.
      change: {
        kind: "accessory",
        accessory: first.draft?.look.accessories.includes("scarf")
          ? "glasses"
          : "scarf",
        enabled: true,
      },
      draftId: second.draft?.id,
    });

    expect(second.draft?.look.traits).toEqual(traits);
    expect(third.draft?.look.traits).toEqual(traits);
  });

  it("records the key on the row when a draft is kept, and frees it when the look is replaced", async () => {
    const draft = await keptLook({ kind: "creature", creature: "otter" });
    const row = avatars.rows.find((one) => one.id === draft.id)!;
    expect(row.traitKey).toBe(OTTER_KEY);

    await keptLook({ kind: "creature", creature: "frog" });

    // The retired look no longer holds the combination.
    expect(row.traitKey).toBeNull();
    const again = await createAvatarDraft({
      sokoBotId: "bot-2",
      userId: "user-2",
      change: { kind: "creature", creature: "otter" },
    });
    expect(again.draft?.look.traits?.deskItem).toBe("none");
  });

  it("answers 409 when two bots keep the same combination, and gives the loser nothing", async () => {
    const mine = await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "creature", creature: "otter" },
    });
    // Both were drafted while the combination was free.
    const theirs = await createAvatarDraft({
      sokoBotId: "bot-2",
      userId: "user-2",
      change: { kind: "creature", creature: "otter" },
    });
    await keepAvatarDraft({
      sokoBotId: BOT,
      draftId: mine.draft!.id,
      userId: USER,
    });
    bots.avatarImageUrl = null;

    await expect(
      keepAvatarDraft({
        sokoBotId: "bot-2",
        draftId: theirs.draft!.id,
        userId: "user-2",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(bots.avatarImageUrl).toBeNull();
    expect(renders.rows.every((row) => row.avatarId === mine.draft?.id)).toBe(
      true,
    );
    expect(
      avatars.rows.find((row) => row.id === theirs.draft?.id)
        ?.claimedBySokoBotId,
    ).toBeNull();
  });

  it("leaves legacy rows and looks without traits out of it", async () => {
    // Two legacy mascots and two crafted looks drawn before traits existed.
    for (const id of ["mascot-1", "mascot-2"]) {
      const row = await avatars.create({
        data: {
          id,
          subject: id,
          background: "b",
          seed: id === "mascot-1" ? 1 : 2,
          model: "m",
          imageUrl: `https://blob.test/${id}.png`,
        },
      });
      await claimAvatar(`bot-${id}`, row.id as string);
    }
    for (const id of ["old-1", "old-2"]) {
      await avatars.create({
        data: {
          id,
          subject: "owl",
          background: "b",
          seed: id === "old-1" ? 3 : 4,
          model: "m",
          imageUrl: `https://blob.test/${id}.webp`,
          styleId: "crafted-desk",
          styleVersion: 1,
          draftForSokoBotId: `bot-${id}`,
          draftExpiresAt: new Date(Date.now() + 60_000),
          look: { creature: "owl", accessories: [], typed: [] },
        },
      });
      await keepAvatarDraft({
        sokoBotId: `bot-${id}`,
        draftId: id,
        userId: USER,
      });
    }

    expect(avatars.rows.map((row) => row.traitKey)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(avatars.rows.map((row) => row.claimedBySokoBotId)).toEqual([
      "bot-mascot-1",
      "bot-mascot-2",
      "bot-old-1",
      "bot-old-2",
    ]);
  });

  describe("time limits", () => {
    it("gives an interactive draft a short first try and the cron one patient one", async () => {
      const draft = await keptLook({ kind: "creature", creature: "otter" });
      expect(draft).toBeDefined();
      expect(providerMock.editImage.mock.calls[0]?.[0].timeoutMs).toBe(
        IMAGE_TIMEOUT_STUDIO_MS,
      );
      providerMock.editImage.mockClear();

      await reconcileAvatarRenders();

      expect(IMAGE_TIMEOUT_STUDIO_MS).toBe(25_000);
      expect(IMAGE_TIMEOUT_RENDER_MS).toBe(120_000);
      expect(providerMock.editImage.mock.calls[0]?.[0].timeoutMs).toBe(
        IMAGE_TIMEOUT_RENDER_MS,
      );
    });

    it("does not fall back when the first route answers", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "creature", creature: "frog" },
      });

      expect(providerMock.editImage).toHaveBeenCalledTimes(1);
      expect(providerMock.editImage.mock.calls[0]?.[0].model).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it("tries the other route once when the first stalls, and the draft succeeds", async () => {
      providerMock.editImage.mockRejectedValueOnce(
        new ImageTimeoutError("slow"),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { draft } = await createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "creature", creature: "frog" },
      });

      expect(draft).not.toBeNull();
      expect(providerMock.editImage).toHaveBeenCalledTimes(2);
      const [first, second] = providerMock.editImage.mock.calls.map(
        (call) => call[0],
      );
      expect(first).toMatchObject({ timeoutMs: IMAGE_TIMEOUT_STUDIO_MS });
      expect(second).toMatchObject({
        model: AVATAR_IMAGE_FALLBACK_MODEL,
        timeoutMs: IMAGE_TIMEOUT_STUDIO_FALLBACK_MS,
        prompt: first.prompt,
        reference: first.reference,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          kind: "avatar_image_fallback",
          primaryModel: AVATAR_IMAGE_MODEL,
          elapsedMs: expect.any(Number),
        }),
      );
      expect(avatars.rows).toHaveLength(1);
    });

    it("answers 503 timed out only when both routes stall", async () => {
      providerMock.editImage.mockRejectedValue(new ImageTimeoutError("slow"));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        createAvatarDraft({
          sokoBotId: BOT,
          userId: USER,
          change: { kind: "creature", creature: "frog" },
        }),
      ).rejects.toMatchObject({
        status: 503,
        cause: { kind: "avatar_draw_timed_out" },
      });

      expect(providerMock.editImage).toHaveBeenCalledTimes(2);
      expect(avatars.rows).toHaveLength(0);
    });

    it("does not retry an error that is not a timeout", async () => {
      providerMock.editImage.mockRejectedValue(new Error("content refused"));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        createAvatarDraft({
          sokoBotId: BOT,
          userId: USER,
          change: { kind: "creature", creature: "frog" },
        }),
      ).rejects.toMatchObject({ cause: { kind: "avatar_draw_failed" } });

      expect(providerMock.editImage).toHaveBeenCalledTimes(1);
    });

    it("never falls back for a render: one patient try, then the row's own retry", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      providerMock.editImage.mockClear();
      providerMock.editImage.mockRejectedValue(new ImageTimeoutError("slow"));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await reconcileAvatarRenders();

      // Five states to draw, each tried once and none on another model.
      expect(providerMock.editImage).toHaveBeenCalledTimes(5);
      for (const [call] of providerMock.editImage.mock.calls) {
        expect(call.model).toBeUndefined();
        expect(call.timeoutMs).toBe(IMAGE_TIMEOUT_RENDER_MS);
      }
    });

    it("answers a stalled draft with a distinct 503 and gives the slot back", async () => {
      providerMock.editImage.mockRejectedValue(new ImageTimeoutError("slow"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const error = await createAvatarDraft({
        sokoBotId: BOT,
        userId: USER,
        change: { kind: "creature", creature: "frog" },
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        status: 503,
        message: "Drawing took too long. Try again.",
        cause: { kind: "avatar_draw_timed_out" },
      });
      expect(avatars.rows).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: "avatar_draw_timed_out" }),
      );
    });

    it("keeps the generic kind for any other draw failure", async () => {
      providerMock.editImage.mockRejectedValue(new Error("quota"));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        createAvatarDraft({
          sokoBotId: BOT,
          userId: USER,
          change: { kind: "creature", creature: "frog" },
        }),
      ).rejects.toMatchObject({ cause: { kind: "avatar_draw_failed" } });
    });

    it("lets a stalled render retry on the next tick, as any failed still does", async () => {
      await keptLook({ kind: "creature", creature: "otter" });
      providerMock.editImage.mockClear();
      providerMock.editImage.mockRejectedValueOnce(
        new ImageTimeoutError("slow"),
      );
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await reconcileAvatarRenders();
      await reconcileUntilSettled();

      expect(renders.rows.map((row) => row.status)).toEqual(
        Array(6).fill("READY"),
      );
    });
  });

  describe("when drawing cannot happen", () => {
    it("says why in the log before it answers 503, with no gateway", async () => {
      getEnvMock.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "token" });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        createAvatarDraft({
          sokoBotId: BOT,
          userId: USER,
          change: { kind: "shuffle" },
        }),
      ).rejects.toMatchObject({ status: 503 });

      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: "avatar_drawing_unavailable" }),
      );
    });

    it("says why in the log when a draw fails", async () => {
      providerMock.editImage.mockRejectedValue(new Error("provider down"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        createAvatarDraft({
          sokoBotId: BOT,
          userId: USER,
          change: { kind: "creature", creature: "frog" },
        }),
      ).rejects.toMatchObject({ status: 503 });

      expect(warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          kind: "avatar_draw_failed",
          error: "provider down",
        }),
      );
    });
  });
});

describe("the style is data", () => {
  const swapStyle: SokoBotAvatarStyle = {
    id: "swap-test",
    version: 7,
    houseScene: "swap-scene.png",
    houseCreatureId: "widget",
    housePrompt: "SWAP HOUSE PROMPT: a gadget on a shelf.",
    rewriterRules: "SWAP REWRITER RULES",
    creatures: [
      {
        id: "widget",
        noun: "widget",
        coats: [
          { id: "blue", phrase: "blue widget" },
          { id: "teal", phrase: "teal widget" },
        ],
      },
      {
        id: "gizmo",
        noun: "gizmo",
        coats: [
          { id: "red", phrase: "red gizmo" },
          { id: "pink", phrase: "pink gizmo" },
        ],
      },
    ],
    accessories: [{ id: "bow", phrase: "a tiny bow" }],
    traits: [
      {
        id: "shelf",
        template: "SWAP shelf: {phrase}.",
        rerollable: true,
        options: [
          { id: "bare", phrase: "bare" },
          { id: "tidy", phrase: "tidy" },
          { id: "messy", phrase: "messy" },
        ],
      },
    ],
    prompts: {
      freshLook: "SWAP fresh: a {to}.{worn} {traits}",
      alsoChange: " SWAP also: {traits}",
      swapCreature: "SWAP: turn the {from} into a {to}.{worn}",
      wearing: " It carries {worn}.",
      addAccessory: "SWAP: add {accessory} to the {c}.",
      removeAccessory: "SWAP: remove {accessory} from the {c}.",
      stillFraming: " SWAP framing.",
      stills: {
        thinking: "SWAP thinking {c}.",
        working: "SWAP working {c}.",
        done: "SWAP done {c}.",
        needs_you: "SWAP needs {c}.",
        offline: "SWAP offline {c}.",
      },
      loops: {
        idle: "SWAP idle {c}.",
        thinking: "SWAP thinking loop {c}.",
        working: "SWAP working loop {c}.",
        done: "SWAP done loop {c}.",
        needs_you: "SWAP needs loop {c}.",
        offline: "SWAP offline loop {c}.",
      },
      loopSuffix: " SWAP suffix.",
    },
    backgroundTarget: () => 200,
  };

  it("runs the whole pipeline in another style and never leaks the clay desk", async () => {
    AVATAR_STYLES[swapStyle.id] = swapStyle;
    providerMock.rewrite.mockResolvedValue({
      edit: "SWAP typed edit",
      note: "",
    });

    const draft = await keptLook(
      { kind: "creature", creature: "gizmo" },
      swapStyle,
    );
    await createAvatarDraft({
      sokoBotId: BOT,
      userId: USER,
      change: { kind: "typed", text: "make it shiny" },
      style: swapStyle,
    });
    await reconcileUntilSettled();

    // The draft was edited from the swap style's own scene.
    expect(providerMock.editImage.mock.calls[0]?.[0].reference).toEqual(
      swapScene.buffer,
    );
    // A full state set, in the new style.
    expect(renders.rows).toHaveLength(AVATAR_STATES.length);
    expect(renders.rows.map((row) => row.status)).toEqual(
      Array(6).fill("READY"),
    );
    expect(avatars.rows.find((row) => row.id === draft.id)).toMatchObject({
      styleId: "swap-test",
      styleVersion: 7,
    });
    // Its own background target, not the clay desk's.
    const thinking = renders.rows.find((row) => row.state === "THINKING")!;
    expect(
      Math.abs(
        (await pixel(blobFiles.get(thinking.stillUrl as string)!, 2, 2))[0]! -
          200,
      ),
    ).toBeLessThanOrEqual(3);

    // Everything the adapter ever received came from the swap style.
    const sent = [
      ...providerMock.editImage.mock.calls.map(
        (call) => `${call[0].system}\n${call[0].prompt}`,
      ),
      ...providerMock.startVideo.mock.calls.map((call) => call[0].prompt),
      ...providerMock.rewrite.mock.calls.map((call) => call[0].rules),
    ].join("\n");
    expect(sent).toContain("SWAP");
    const clay = CRAFTED_DESK_STYLE;
    const forbidden = [
      clay.housePrompt.slice(0, 60),
      clay.rewriterRules.slice(0, 60),
      ...clay.creatures.flatMap((one) => [
        one.noun,
        ...one.coats.map((coat) => coat.phrase),
      ]),
      ...clay.traits.flatMap((axis) =>
        axis.options.map((option) => option.phrase),
      ),
      "pink pot",
      ...clay.accessories.map((one) => one.phrase),
      "desk",
      "flower pot",
      "Iris Flower",
      "#FF51FF",
      "#F5F5F5",
      "clay",
      "book",
    ];
    for (const text of forbidden) expect(sent).not.toContain(text);
  }, 120_000);
});
