import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CmoPiece } from "@/services/cmo-production.service";

const m = vi.hoisted(() => ({
  generateText: vi.fn(),
  append: vi.fn(),
  turnFindUnique: vi.fn(),
  readCmoProduction: vi.fn(),
  findStyleReferences: vi.fn(),
  getSocialPost: vi.fn(),
  startCmoProduction: vi.fn(),
  draftProblems: vi.fn(),
  chargeCheck: vi.fn(),
  referenceFindMany: vi.fn(),
  styles: { on: true },
}));

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: m.generateText,
}));
vi.mock("@/lib/soko-bot/model-policy", () => ({
  sokoBotModelRequest: () => ({ model: "test-model" }),
}));
vi.mock("@/lib/soko-bot/turn-loop", () => ({
  RuntimeEventLog: class {
    append = m.append;
  },
  runtimeEvent: (type: string, data: unknown) => ({ type, data }),
  sokoBotToolCallTimeoutMs: () => 115_000,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: m.turnFindUnique },
    referenceImage: { findMany: m.referenceFindMany },
  },
}));
vi.mock("@/services/brand-brain.service", () => ({
  getBrandBrain: async () => null,
  parseBrandBrain: () => null,
  compactBrandBrain: () => null,
}));
vi.mock("@/services/cmo-brand-media.service", () => ({
  listCmoBrandPictures: async () => [{ fileId: "file-home", alt: "Home" }],
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  startCmoProduction: m.startCmoProduction,
  findCusoForBot: async () => ({
    sokoBotId: "bot-1",
    projectId: "project-1",
    businessName: "nmkr.io",
    websiteUrl: "https://nmkr.io",
  }),
}));
vi.mock("@/services/cmo-production.service", async (original) => ({
  ...(await original<typeof import("@/services/cmo-production.service")>()),
  cmoConnectedChannels: async () => new Set(["x"]),
  readCmoProduction: m.readCmoProduction,
}));
vi.mock("@/services/reference-library.service", async (original) => ({
  ...(await original<typeof import("@/services/reference-library.service")>()),
  findStyleReferences: m.findStyleReferences,
  referenceLibraryAvailable: () => m.styles.on,
}));
vi.mock("@/services/cmo-plan-review.service", () => ({
  cmoDraftProblems: m.draftProblems,
}));
vi.mock("./cmo", () => ({ chargeCheck: m.chargeCheck }));
vi.mock("@/services/social-posts.service", () => ({
  getSocialPost: m.getSocialPost,
}));

import {
  cmoChunkProof,
  cmoMonthWriterBudgetMs,
  cmoShortOf,
  cmoWriterChunks,
  cmoWriterModelTimeoutMs,
  cmoWriterSystem,
  writeCmoMonthPieces,
} from "./cmo-month-writer";

const strategy = {
  summary: "Launch on Cardano",
  contentLanguage: "English",
  pillars: [{ name: "Launch", share: 100 }],
  mix: [{ approach: "educational", share: 100 }],
  campaigns: [],
  calendar: [] as unknown[],
};

function piece(id: string, extra: Partial<CmoPiece> = {}): CmoPiece {
  return {
    id,
    date: "2026-11-21",
    channel: "x",
    format: "post",
    title: `Title ${id}`,
    status: "idea",
    approach: "educational",
    pillar: "Launch",
    media: [],
    ...extra,
  } as CmoPiece;
}

function written(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    onlyUs: "NMKR Studio",
    draft: `Words of ${id}`,
    firstComment: null,
    visual: null,
    visualFileIds: null,
    slides: null,
    styleLook: null,
    pictureKind: null,
    purpose: null,
    headline: null,
    slideHeadlines: null,
    script: null,
    presenter: null,
    voice: null,
    languageCode: null,
    ...extra,
  };
}

const input = {
  turnId: "turn-1",
  sessionId: "session-1",
  toolCallId: "call-1",
  capability: "write_month_pieces",
  input: {},
} as never;
const authorized = {
  turn: {
    id: "turn-1",
    sokoBotId: "bot-1",
    workspaceId: "ws-1",
    versionId: "cmo-v6",
  },
} as never;

function runtime(
  refuse: (capability: string, body: any) => string | null = () => null,
) {
  const executeTool = vi.fn(async (call: any) => {
    const reason = refuse(call.capability, call.input);
    if (reason) throw new Error(reason);
    return {};
  });
  return { executeTool } as never as { executeTool: typeof executeTool };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.styles.on = true;
  m.turnFindUnique.mockResolvedValue({
    clientTurnId: "cmo:production:bot-1:1:1:0",
  });
  m.getSocialPost.mockResolvedValue({ revision: 3 });
  m.draftProblems.mockResolvedValue({ problems: [], costUsd: 0 });
  m.findStyleReferences.mockResolvedValue([
    { id: "ref-used" },
    { id: "ref-a" },
    { id: "ref-b" },
  ]);
  // The month as read for its checks and at the end, unless a test says.
  m.readCmoProduction.mockResolvedValue({
    strategy,
    pending: [],
    failedMedia: new Set(),
  });
});

describe("cmoWriterChunks", () => {
  it("chunks pieces per network in date order, ten at most", () => {
    const pieces = [
      ...Array.from({ length: 12 }, (_, n) =>
        piece(`x${n}`, { date: `2026-11-${String(30 - n).padStart(2, "0")}` }),
      ),
      piece("li", { channel: "linkedin" }),
    ];
    const chunks = cmoWriterChunks(pieces);
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 2, 1]);
    expect(chunks[0]![0]!.id).toBe("x11");
    expect(new Set(chunks[2]!.map((one) => one.channel))).toEqual(
      new Set(["linkedin"]),
    );
  });
});

describe("cmoChunkProof", () => {
  it("gives each chunk its own named proof, so chunks written at once do not repeat a customer", () => {
    const proof = ["Deel", "Mintlify", "Ramp", "Linear", "Vercel"];
    const shares = [0, 1, 2].map((chunk) => cmoChunkProof(proof, chunk, 3));
    expect(shares).toEqual([
      ["Deel", "Linear"],
      ["Mintlify", "Vercel"],
      ["Ramp"],
    ]);
    expect(new Set(shares.flat()).size).toBe(proof.length);
    // More chunks than proof: each still gets one, shared as little as can be.
    expect(cmoChunkProof(["Deel", "Mintlify"], 3, 4)).toEqual(["Mintlify"]);
    expect(cmoChunkProof([], 0, 2)).toEqual([]);
  });
});

describe("writeCmoMonthPieces", () => {
  it("works in a production run only", async () => {
    m.turnFindUnique.mockResolvedValue({ clientTurnId: "chat:1" });
    await expect(
      writeCmoMonthPieces(runtime() as never, input, authorized),
    ).rejects.toThrow("production run only");
  });

  it("writes every chunk at once and saves each piece through Cuso's own tools", async () => {
    const pieces = [
      piece("p1"),
      piece("p2", { format: "image" }),
      piece("p3", { format: "image" }),
    ];
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy: { ...strategy, calendar: [{ styleReferenceId: "ref-used" }] },
        pending: pieces,
        failedMedia: new Set(),
      })
      .mockResolvedValueOnce({ strategy, pending: [], failedMedia: new Set() });
    m.generateText.mockResolvedValue({
      output: {
        pieces: [
          written("p1"),
          written("p2", {
            visual: "A mint screen",
            styleLook: "poster",
            headline: "Mint in minutes",
          }),
          written("p3", {
            visual: "A wallet",
            styleLook: "label",
            visualFileIds: ["file-home"],
          }),
        ],
      },
      usage: { inputTokens: 12_000, outputTokens: 2_000 },
      providerMetadata: { gateway: { cost: "0.002" } },
    });
    const tools = runtime();
    const result = await writeCmoMonthPieces(tools as never, input, authorized);

    expect(result).toMatchObject({ written: 3, refused: [], left: 0 });
    const calls = tools.executeTool.mock.calls.map(([call]) => call);
    const visuals = calls.filter((call) => call.capability === "save_strategy");
    expect(visuals).toHaveLength(1);
    const saved = visuals[0]!.input.strategy.calendar;
    // A style per piece, never one the month already uses.
    expect(
      saved.map((entry: any) => [
        entry.id,
        entry.styleReferenceId,
        entry.headline,
      ]),
    ).toEqual([
      ["p2", "ref-a", "Mint in minutes"],
      ["p3", "ref-b", undefined],
    ]);
    expect(saved[1].visualFileIds).toEqual(["file-home"]);
    const texts = calls.filter(
      (call) => call.capability === "update_social_post",
    );
    expect(
      texts.map((call) => [
        call.input.postId,
        call.input.revision,
        call.input.text,
      ]),
    ).toEqual([
      ["p1", 3, "Words of p1"],
      ["p2", 3, "Words of p2"],
      ["p3", 3, "Words of p3"],
    ]);
    // Core schedules and starts the pictures at once.
    expect(m.startCmoProduction).toHaveBeenCalledWith("bot-1");
    // Each save is its own child call of this one.
    expect(new Set(calls.map((call) => call.toolCallId)).size).toBe(
      calls.length,
    );
    expect(calls.every((call) => call.toolCallId.startsWith("call-1:"))).toBe(
      true,
    );
    // The writer's tokens are charged to the turn.
    expect(m.append).toHaveBeenCalledWith({
      type: "step.completed",
      data: expect.objectContaining({
        modelId: "openai/gpt-6-luna",
        usage: expect.objectContaining({ inputTokens: 12_000, costUsd: 0.002 }),
      }),
    });
  });

  // cmo-v8: NMKR's how-to month took an infographic for 56 of 69 pictures.
  it("picks each cmo-v8 picture's print among the kinds that keep the month varied", async () => {
    const pieces = [
      piece("v1", { format: "image", date: "2026-11-21", time: "09:00" }),
      piece("v2", { format: "image", date: "2026-11-22", time: "09:00" }),
    ];
    m.referenceFindMany.mockResolvedValue([{ id: "ref-used", kind: "poster" }]);
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy: {
          ...strategy,
          calendar: [
            ...pieces,
            {
              ...piece("v0", { format: "image", date: "2026-11-20" }),
              styleReferenceId: "ref-used",
            },
          ],
        },
        pending: pieces,
        failedMedia: new Set(),
      })
      .mockResolvedValueOnce({ strategy, pending: [], failedMedia: new Set() });
    m.findStyleReferences
      .mockResolvedValueOnce([{ id: "ref-label", kind: "label" }])
      .mockResolvedValueOnce([{ id: "ref-chart", kind: "infographic" }]);
    m.generateText.mockResolvedValue({
      output: {
        pieces: [
          written("v1", {
            visual: "Three steps of a mint",
            styleLook: "steps",
            purpose: "how-to",
          }),
          written("v2", {
            visual: "Fees by plan",
            styleLook: "a chart",
            purpose: "data",
          }),
        ],
      },
      usage: { inputTokens: 1_000, outputTokens: 200 },
      providerMetadata: { gateway: { cost: "0.001" } },
    });
    await writeCmoMonthPieces(runtime() as never, input, {
      turn: { ...(authorized as any).turn, versionId: "cmo-v8" },
    } as never);

    const [first, second] = m.findStyleReferences.mock.calls.map(
      ([query]) => query,
    );
    // After a poster on x, a how-to piece takes neither a poster nor an
    // infographic; a piece of numbers may take one, but not the label
    // its neighbour just took.
    expect(first).toMatchObject({ purpose: "how-to", exclude: ["ref-used"] });
    expect(first.kinds).not.toContain("poster");
    expect(first.kinds).not.toContain("infographic");
    expect(second).toMatchObject({ purpose: "data" });
    expect(second.kinds).toContain("infographic");
    expect(second.kinds).not.toContain("label");
    expect(second.exclude).toEqual(["ref-used", "ref-label"]);
  });

  it("leaves a cmo-v7 Cuso's search as it was", async () => {
    const pieces = [piece("v1", { format: "image" })];
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy,
        pending: pieces,
        failedMedia: new Set(),
      })
      .mockResolvedValueOnce({ strategy, pending: [], failedMedia: new Set() });
    m.generateText.mockResolvedValue({
      output: {
        pieces: [
          written("v1", {
            visual: "Steps",
            styleLook: "steps",
            purpose: "how-to",
          }),
        ],
      },
      usage: { inputTokens: 1_000, outputTokens: 200 },
      providerMetadata: { gateway: { cost: "0.001" } },
    });
    await writeCmoMonthPieces(runtime() as never, input, authorized);
    const [query] = m.findStyleReferences.mock.calls[0]!;
    expect(query.kinds).toBeUndefined();
    expect(query.purpose).toBeUndefined();
  });

  it("asks once more with Core's reason, then hands back what still fails", async () => {
    const pieces = [piece("p1"), piece("p2")];
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy,
        pending: pieces,
        failedMedia: new Set(),
      })
      .mockResolvedValueOnce({ strategy, pending: [], failedMedia: new Set() })
      .mockResolvedValueOnce({
        strategy,
        pending: [pieces[1]],
        failedMedia: new Set(),
      });
    m.generateText
      .mockResolvedValueOnce({
        output: { pieces: [written("p1"), written("p2")] },
      })
      .mockResolvedValueOnce({
        output: {
          pieces: [
            written("p1", { draft: "Fresh p1" }),
            written("p2", { draft: "Again p2" }),
          ],
        },
      });
    const tools = runtime((capability, body) =>
      capability === "update_social_post" &&
      (body.text === "Words of p1" || body.postId === "p2")
        ? "Rewrite the post: it says nearly what another post says."
        : null,
    );
    const result = await writeCmoMonthPieces(tools as never, input, authorized);

    const repair = m.generateText.mock.calls[1]![0].prompt as string;
    expect(repair).toContain(
      "Core refused your last version: Rewrite the post",
    );
    expect(repair).toContain("Last version: Words of p1");
    expect(result.written).toBe(1);
    expect(result.refused).toEqual([
      {
        id: "p2",
        title: "Title p2",
        reason: "Rewrite the post: it says nearly what another post says.",
      },
    ]);
    expect(result.left).toBe(0);
    expect(result.next).toContain("Fix each refused piece yourself");
  });

  it("rewrites what the month's own checks find before anything goes back to Cuso", async () => {
    const pieces = [piece("p1"), piece("p2")];
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy,
        pending: pieces,
        failedMedia: new Set(),
      })
      .mockResolvedValueOnce({
        strategy: {
          ...strategy,
          calendar: [
            { id: "p1", draft: "Words of p1" },
            { id: "p2", draft: "Words of p2" },
          ],
        },
        pending: [],
        failedMedia: new Set(),
      })
      .mockResolvedValueOnce({ strategy, pending: [], failedMedia: new Set() });
    m.draftProblems.mockResolvedValue({
      problems: [
        'p2 opens like p1 ("Words of p…"); give it its own first line.',
        '"team booking" is in 3 drafts (x9, p1, p2); keep it in at most 2 and say something new in the rest.',
      ],
      costUsd: 0.0001,
    });
    m.generateText
      .mockResolvedValueOnce({
        output: { pieces: [written("p1"), written("p2")] },
      })
      .mockResolvedValueOnce({
        output: { pieces: [written("p2", { draft: "Fresh p2" })] },
      });
    const tools = runtime();
    const result = await writeCmoMonthPieces(tools as never, input, authorized);

    const repair = m.generateText.mock.calls[1]![0].prompt as string;
    expect(repair).toContain("p2 opens like p1");
    expect(repair).toContain("Last version: Words of p2");
    expect(m.chargeCheck).toHaveBeenCalledWith(
      input,
      expect.any(String),
      0.0001,
    );
    expect(result.refused).toEqual([]);
    const texts = tools.executeTool.mock.calls
      .map(([call]) => call)
      .filter((call) => call.capability === "update_social_post")
      .map((call) => call.input.text);
    expect(texts).toEqual(["Words of p1", "Words of p2", "Fresh p2"]);
  });

  it("answers inside its tool timeout when the chunks were slow", async () => {
    // NMKR's test copy, 2026-11-21: calls took 96 to 119 s against a 90 s
    // limit, so Cuso read "timed out twice" and ended the run.
    let now = Date.parse("2026-11-21T08:31:49Z");
    const start = now;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy,
        pending: [piece("p1")],
        failedMedia: new Set(),
      })
      .mockResolvedValue({ strategy, pending: [], failedMedia: new Set() });
    m.draftProblems.mockResolvedValue({ problems: [], costUsd: 0 });
    m.generateText.mockImplementation(async () => {
      now += 90_000;
      return { output: { pieces: [written("p1")] } };
    });
    await writeCmoMonthPieces(runtime() as never, input, authorized);
    clock.mockRestore();

    // The month's checks would have run past the deadline: the next call does them.
    expect(m.draftProblems).not.toHaveBeenCalled();
    expect(now - start).toBeLessThan(115_000);
  });

  it("gives a model call only what the deadline leaves", () => {
    expect(cmoWriterModelTimeoutMs(100_000, 0)).toBe(75_000);
    expect(cmoWriterModelTimeoutMs(100_000, 50_000)).toBe(35_000);
    expect(cmoWriterModelTimeoutMs(100_000, 90_000)).toBe(0);
    expect(cmoMonthWriterBudgetMs()).toBe(100_000);
  });

  it("leaves pictures to the brand's own pictures where no library is set up", async () => {
    m.styles.on = false;
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy,
        pending: [piece("p1", { format: "image" })],
        failedMedia: new Set(),
      })
      .mockResolvedValueOnce({ strategy, pending: [], failedMedia: new Set() });
    m.generateText.mockResolvedValue({
      output: {
        pieces: [
          written("p1", {
            visual: "A wallet",
            styleLook: "poster",
            headline: "Hi",
          }),
        ],
      },
    });
    const tools = runtime();
    await writeCmoMonthPieces(tools as never, input, authorized);
    const entry =
      tools.executeTool.mock.calls[0]![0].input.strategy.calendar[0];
    expect(entry.styleReferenceId).toBeUndefined();
    expect(entry.headline).toBeUndefined();
    expect(m.findStyleReferences).not.toHaveBeenCalled();
  });
});

describe("writeCmoMonthPieces on cmo-v20", () => {
  const v17 = {
    turn: { ...(authorized as any).turn, versionId: "cmo-v20" },
  } as never;
  const month = {
    ...strategy,
    offer: {
      what: "Studio",
      why: "w",
      proof: [],
      action: "Open a free Studio account",
    },
    funnel: [
      { stage: "action", goal: "g", owner: "cuso", channels: ["x"], plays: [] },
    ],
  };
  const usage = { inputTokens: 1_000, outputTokens: 200 };
  beforeEach(() => {
    m.referenceFindMany.mockResolvedValue([]);
  });

  it("first gives the batch its points, in a call of their own, saved as claims", async () => {
    const pieces = [piece("p1"), piece("p2", { date: "2026-11-22" })];
    m.readCmoProduction.mockResolvedValue({
      strategy: { ...month, calendar: pieces },
      pending: pieces,
      failedMedia: new Set(),
    });
    m.generateText.mockResolvedValueOnce({
      output: {
        facts: [
          { id: "f1", fact: "3% a token" },
          { id: "f2", fact: "No monthly fee" },
        ],
        points: [
          {
            id: "a",
            pillar: "Launch",
            factId: "f1",
            point: "Studio mints at 3% a token",
          },
          {
            id: "b",
            pillar: "Launch",
            factId: "f2",
            point: "Studio has no monthly fee",
          },
        ],
        pieces: [
          { id: "p1", point: "a" },
          { id: "p2", point: "b" },
        ],
      },
      usage,
    });
    const tools = runtime();
    const result = await writeCmoMonthPieces(tools as never, input, v17);

    expect(result).toMatchObject({ written: 0, left: 2 });
    expect(result.next).toMatch(/again/);
    expect(m.generateText).toHaveBeenCalledTimes(1);
    const [save] = tools.executeTool.mock.calls.map(([call]) => call);
    expect(save!.capability).toBe("save_strategy");
    expect(
      save!.input.strategy.calendar.map((entry: any) => [
        entry.id,
        entry.claim,
      ]),
    ).toEqual([
      ["p1", "Studio mints at 3% a token"],
      ["p2", "Studio has no monthly fee"],
    ]);
  });

  it("writes claimed pieces with their network's skill and the offer line, and sends an offer piece back without its link", async () => {
    const pieces = [
      piece("p1", {
        approach: "product-led",
        claim: "Studio mints at 3% a token",
      }),
      piece("p2", { date: "2026-11-22", claim: "Studio has no monthly fee" }),
    ];
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy: { ...month, calendar: pieces },
        pending: pieces,
        failedMedia: new Set(),
      })
      .mockResolvedValue({
        strategy: month,
        pending: [],
        failedMedia: new Set(),
      });
    m.generateText
      .mockResolvedValueOnce({
        output: {
          pieces: [
            written("p1"),
            written("p2", { firstComment: "https://nmkr.io/studio" }),
          ],
        },
        usage,
      })
      // The repair round, told why p1 was refused.
      .mockResolvedValueOnce({
        output: {
          pieces: [written("p1", { firstComment: "https://nmkr.io" })],
        },
        usage,
      });
    const tools = runtime();
    const result = await writeCmoMonthPieces(tools as never, input, v17);

    const prompts = m.generateText.mock.calls.map(
      ([call]) => call.prompt as string,
    );
    const systems = m.generateText.mock.calls.map(
      ([call]) => call.system as string,
    );
    expect(systems[0]).toContain("claim: Studio has no monthly fee");
    expect(systems[0]).not.toContain('<skill id="x">');
    expect(prompts[0]).toContain('<skill id="x">');
    expect(prompts[0]).toMatch(/p1 .*claim: Studio mints at 3% a token/);
    expect(prompts[0]).toContain(
      'offer piece: it ends with "Open a free Studio account"',
    );
    // Both are offer pieces (two a week); p1 came back without its link,
    // and the repair round was told so.
    expect(prompts[1]).toMatch(/p1 .*It is an offer piece: put the link/);
    expect(result.refused).toEqual([]);
    expect(
      tools.executeTool.mock.calls
        .map(([call]) => call)
        .filter((call) => call.capability === "update_social_post")
        .map((call) => call.input.postId),
    ).toEqual(["p2", "p1"]);
  });

  it("writes as before when the points call fails", async () => {
    const pieces = [piece("p1")];
    m.readCmoProduction
      .mockResolvedValueOnce({
        strategy: { ...month, calendar: pieces },
        pending: pieces,
        failedMedia: new Set(),
      })
      .mockResolvedValue({
        strategy: month,
        pending: [],
        failedMedia: new Set(),
      });
    m.generateText
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({
        output: {
          pieces: [written("p1", { firstComment: "https://nmkr.io" })],
        },
        usage,
      });
    const result = await writeCmoMonthPieces(runtime() as never, input, v17);
    expect(result).toMatchObject({ written: 1, refused: [] });
  });
});

describe("a cmo-v20 short video", () => {
  const script =
    "Your GitHub says a lot about you. Nobody reads it. Entry turns it into one clear page.";

  it("keeps its kind, script and hook line", () => {
    expect(
      cmoShortOf(
        {
          shortFormat: "top_three",
          script: ` ${script} `,
          hookLine: " One  page ",
        },
        true,
      ),
    ).toEqual({ shortFormat: "top_three", script, hookLine: "One page" });
  });

  it("tells a website tour as a story when the brand has no website", () => {
    expect(
      cmoShortOf({ shortFormat: "site_tour", script, hookLine: null }, false),
    ).toEqual({ shortFormat: "voiceover", script });
  });

  it("keeps no hook line on a slideshow and drops one too long to show", () => {
    expect(
      cmoShortOf({ shortFormat: "slideshow", script, hookLine: "Hi" }, true),
    ).toEqual({ shortFormat: "slideshow", script });
    expect(
      cmoShortOf(
        { shortFormat: "voiceover", script, hookLine: "x".repeat(49) },
        true,
      ),
    ).toEqual({ shortFormat: "voiceover", script });
  });

  it("is not a short without a kind or a script Core can speak", () => {
    expect(
      cmoShortOf({ shortFormat: null, script, hookLine: null }, true),
    ).toBe(null);
    expect(
      cmoShortOf(
        { shortFormat: "voiceover", script: "Too short", hookLine: null },
        true,
      ),
    ).toBe(null);
  });

  it("is briefed only to a cmo-v20 writer, without a tour for a brand with no site", () => {
    const base = {
      businessName: "Entry",
      strategy: strategy as never,
      brain: null,
      proof: [],
      brandPictures: [],
      styles: false,
    };
    const v16 = cmoWriterSystem({ ...base, shorts: { website: false } });
    expect(v16).toContain("## Short videos");
    expect(v16).toContain("This brand has no website: never site_tour.");
    expect(cmoWriterSystem(base)).toContain(
      "Leave shortFormat and hookLine null.",
    );
    expect(cmoWriterSystem(base)).not.toContain("## Short videos");
  });
});
