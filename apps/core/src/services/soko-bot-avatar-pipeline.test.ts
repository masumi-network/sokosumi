import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";
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

/**
 * Seam 1: the avatar pipeline end to end. The Gateway adapter is faked, and so
 * are Blob, Prisma (an in-memory table that honours the filters the pipeline
 * uses) and env. ffmpeg is real: the levels step and the WebP loops are
 * proven on a tiny generated still and clip.
 */

const { providerMock, blobFiles, getEnvMock } = vi.hoisted(() => ({
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
  put: async (pathname: string, body: Buffer) => {
    const url = `https://blob.test/${pathname}`;
    blobFiles.set(url, Buffer.from(body));
    return { url };
  },
}));
vi.mock("@/lib/soko-bot-avatar/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot-avatar/provider")>()),
  avatarProvider: () => providerMock,
}));
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
      : value;
  }
}

let clock = 0;
const tick = () => new Date(Date.now() + (clock += 1));

class Table {
  rows: Row[] = [];
  constructor(
    private readonly defaults: () => Row,
    private readonly view: (row: Row) => Row = (row) => row,
  ) {}
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

const avatars = new Table(() => ({
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
  styleId: "mascot",
  styleVersion: 1,
}));
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
  (row) => ({
    ...row,
    avatar: avatars.rows.find((one) => one.id === row.avatarId),
  }),
);
const bots: Row = { id: "bot-1", avatarImageUrl: null };
Object.assign(db, {
  sokoBotAvatar: avatars,
  sokoBotAvatarRender: renders,
  sokoBot: {
    update: async ({ data }: { data: Row }) => Object.assign(bots, data),
  },
});

import { LIMITS } from "@/config/constants";
import { levelStill } from "@/lib/soko-bot-avatar/media";
import { VideoSubmissionUncertainError } from "@/lib/soko-bot-avatar/provider";
import {
  AVATAR_STATES,
  AVATAR_STYLES,
  CRAFTED_DESK_STYLE,
  type SokoBotAvatarStyle,
} from "@/lib/soko-bot-avatar/style";
import {
  MAX_RENDER_ATTEMPTS,
  reconcileAvatarRenders,
} from "@/services/soko-bot-avatar-render.service";
import {
  createAvatarDraft,
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

/** The colour of one pixel of a WebP, decoded with ffmpeg. */
function pixel(webp: Buffer, x: number, y: number): number[] {
  const rgb = ffmpeg(
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
    webp,
  );
  const width = Math.sqrt(rgb.length / 3);
  const at = (y * width + x) * 3;
  return [rgb[at]!, rgb[at + 1]!, rgb[at + 2]!];
}

/** The first frame of an animated WebP, rewrapped as a still ffmpeg can decode. */
function firstFrame(animated: Buffer): Buffer {
  const at = animated.indexOf("ANMF");
  const size = animated.readUInt32LE(at + 4);
  // An ANMF payload is a 16-byte frame header, then the frame's own chunks.
  const chunks = animated.subarray(at + 8 + 16, at + 8 + size);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0);
  header.writeUInt32LE(4 + chunks.length, 4);
  header.write("WEBP", 8);
  return Buffer.concat([header, chunks]);
}

/** Canvas size and frame count read from the WebP container itself. */
function webpInfo(file: Buffer) {
  expect(file.subarray(0, 4).toString()).toBe("RIFF");
  expect(file.subarray(8, 12).toString()).toBe("WEBP");
  if (file.subarray(12, 16).toString() === "VP8 ") {
    // A plain lossy still: the size sits in the frame header.
    return {
      animated: false,
      width: (file[26]! | (file[27]! << 8)) & 0x3fff,
      height: (file[28]! | (file[29]! << 8)) & 0x3fff,
      frames: 0,
    };
  }
  expect(file.subarray(12, 16).toString()).toBe("VP8X");
  return {
    animated: (file[20]! & 0x02) !== 0,
    width: (file[24]! | (file[25]! << 8) | (file[26]! << 16)) + 1,
    height: (file[27]! | (file[28]! << 8) | (file[29]! << 16)) + 1,
    frames: file.toString("latin1").split("ANMF").length - 1,
  };
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
  // One second of a square sliding over a background that has drifted dark.
  const clip = path.join(scratch, "clip.mp4");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0xE0E0E0:s=128x128:d=1:r=15",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x884422:s=30x30:d=1:r=15",
    "-filter_complex",
    "[0][1]overlay=x='t*60':y=50:eval=frame",
    "-c:v",
    "mpeg4",
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
  bots.avatarImageUrl = null;
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
    const [r, g, b] = pixel(leveled, 2, 2);
    for (const channel of [r, g, b]) {
      expect(Math.abs(channel! - 245)).toBeLessThanOrEqual(2);
    }
    expect(webpInfo(leveled)).toMatchObject({
      animated: false,
      width: 640,
      height: 640,
    });
  });

  it("clamps the correction instead of chasing a far-off background", async () => {
    // 0xEB (235) toward 100 would need 0.43; the clamp stops at 0.85.
    const leveled = await levelStill(fixturePng, 100);

    expect(Math.abs(pixel(leveled, 2, 2)[0]! - 235 * 0.85)).toBeLessThanOrEqual(
      4,
    );
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
    expect(webpInfo(stored).width).toBe(640);
    // And it came back levelled to #F5F5F5.
    expect(Math.abs(pixel(stored, 2, 2)[0]! - 245)).toBeLessThanOrEqual(1);
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
  it("walks every state to READY with a still and two animated loops", async () => {
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
      const loop = webpInfo(blobFiles.get(row.loopUrl as string)!);
      const large = webpInfo(blobFiles.get(row.loopLargeUrl as string)!);
      expect(loop).toMatchObject({ animated: true, width: 320, height: 320 });
      expect(large).toMatchObject({ animated: true, width: 560, height: 560 });
      expect(loop.frames).toBeGreaterThan(5);
      // Loops are colour-corrected to the state's background.
      const target = row.state === "OFFLINE" ? 215 : 245;
      const corner = pixel(
        firstFrame(blobFiles.get(row.loopUrl as string)!),
        3,
        3,
      )[0]!;
      expect(Math.abs(corner - target)).toBeLessThanOrEqual(3);
    }
    // The still of a dimmer state lands on its own, darker background.
    const offline = renders.rows.find((row) => row.state === "OFFLINE")!;
    expect(
      Math.abs(
        pixel(blobFiles.get(offline.stillUrl as string)!, 2, 2)[0]! - 215,
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

  it("never pays twice for a video whose submission is uncertain", async () => {
    await keptLook({ kind: "creature", creature: "otter" });
    providerMock.startVideo.mockImplementation(
      async (input: { prompt: string }) => {
        if (input.prompt.includes("reads, its eyes move")) {
          throw new VideoSubmissionUncertainError("socket hang up");
        }
        return { job: "ok" };
      },
    );

    await reconcileUntilSettled();
    await reconcileAvatarRenders();
    await reconcileAvatarRenders();

    const working = renders.rows.find((row) => row.state === "WORKING")!;
    expect(working.status).toBe("SUBMISSION_UNCERTAIN");
    // Its still survives; only the loop is missing.
    expect(working.stillUrl).toBeTruthy();
    const attempts = providerMock.startVideo.mock.calls.filter((call) =>
      call[0].prompt.includes("reads, its eyes move"),
    );
    expect(attempts).toHaveLength(1);
  }, 120_000);

  it("calls a submit whose lease ran out uncertain, and does not resubmit it", async () => {
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
    expect(providerMock.startVideo).not.toHaveBeenCalled();
  });

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

describe("the style is data", () => {
  const swapStyle: SokoBotAvatarStyle = {
    id: "swap-test",
    version: 7,
    houseScene: CRAFTED_DESK_STYLE.houseScene,
    houseCreatureId: "widget",
    housePrompt: "SWAP HOUSE PROMPT: a gadget on a shelf.",
    rewriterRules: "SWAP REWRITER RULES",
    creatures: [
      { id: "widget", noun: "widget", description: "blue widget" },
      { id: "gizmo", noun: "gizmo", description: "red gizmo" },
    ],
    accessories: [{ id: "bow", phrase: "a tiny bow" }],
    prompts: {
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
        pixel(blobFiles.get(thinking.stillUrl as string)!, 2, 2)[0]! - 200,
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
      ...clay.creatures.flatMap((one) => [one.noun, one.description]),
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
