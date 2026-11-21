import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const {
  startGeneration,
  listImageOptions,
  readGeneration,
  readBrandContext,
  listStudioProducts,
  readAdHeadline,
  saveAdHeadline,
} = vi.hoisted(() => ({
  startGeneration: vi.fn(),
  listImageOptions: vi.fn(),
  readGeneration: vi.fn(),
  readBrandContext: vi.fn(),
  listStudioProducts: vi.fn(),
  readAdHeadline: vi.fn(),
  saveAdHeadline: vi.fn(),
}));
vi.mock("../lib/core", () => ({
  startGeneration,
  listImageOptions,
  readGeneration,
  readBrandContext,
  listStudioProducts,
  readAdHeadline,
  saveAdHeadline,
}));

import adHeadline from "./ad_headline";
import check from "./check_generation";
import generate from "./generate_image";
import options from "./list_image_options";
import products from "./list_products";
import brandContext from "./read_brand_context";
import refine from "./refine_image";

// These tools use only session identity and turn ID from the runtime context.
// eve 0.85 requires `to` and `channel` on ToolContext. This fixture does not call them.
const ctx: Parameters<typeof generate.execute>[1] = {
  getSandbox: vi.fn(),
  getToken: vi.fn(),
  requireAuth: () => {
    throw new Error("Unexpected auth request");
  },
  to: () => {
    throw new Error("Unexpected channel send");
  },
  channel: { kind: "http", metadata: {} },
  abortSignal: new AbortController().signal,
  callId: "call-1",
  toolName: "generate_image",
  messages: [],
  session: {
    id: "session-1",
    turn: { id: "turn-1", sequence: 1 },
    auth: {
      initiator: null,
      current: {
        authenticator: "test",
        principalId: "user-1",
        principalType: "user",
        attributes: {
          sokosumiUserId: "user-1",
          sokosumiProjectId: "project-1",
        },
      },
    },
  },
};

const base = {
  prompt: "A calm coffee campaign",
  modelId: "gemini-pro" as const,
  aspectRatio: "1:1" as const,
  resolution: "1K" as const,
  outputFormat: "png" as const,
  seed: null,
  placementId: null,
  variant: 1,
};

describe("image generation tools", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("STUDIO_AGENT_ROUTER_TRIAL", "off");
    vi.clearAllMocks();
    startGeneration.mockResolvedValue({
      job: {
        id: "job-1",
        status: "QUEUED",
        note: "Queued",
        model: "fal-ai/flux-2-pro",
        settings: {},
      },
    });
  });

  it("reads and saves an approved headline without starting a generation", async () => {
    const assetId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const identity = { userId: "user-1", projectId: "project-1" };
    const headline = { text: "Brew at your own pace.", revision: 4 };
    const options = {
      headline: { text: null, revision: 3 },
      approvedLines: [headline.text],
    };
    readAdHeadline.mockResolvedValueOnce(options);
    saveAdHeadline.mockResolvedValueOnce(headline);
    expect(await adHeadline.execute({ action: "read", assetId }, ctx)).toEqual(
      options,
    );
    expect(readAdHeadline).toHaveBeenCalledExactlyOnceWith(identity, assetId);
    await expect(
      adHeadline.execute({ action: "save", assetId, text: headline.text }, ctx),
    ).rejects.toThrow(/revision/);
    expect(saveAdHeadline).not.toHaveBeenCalled();
    expect(
      await adHeadline.execute(
        {
          action: "save",
          assetId,
          expectedRevision: 3,
          text: headline.text,
        },
        ctx,
      ),
    ).toEqual({ assetId, headline });
    expect(saveAdHeadline).toHaveBeenCalledExactlyOnceWith(identity, assetId, {
      expectedRevision: 3,
      text: headline.text,
    });
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it("forwards chosen model, placement, output format and seed to Core without changing scope", async () => {
    const input = {
      ...base,
      modelId: "ideogram-v3" as const,
      route: "text_heavy" as const,
      placementId: "pinterest-pin",
      outputFormat: "jpeg" as const,
      seed: 17,
    };
    const result = await generate.execute(input, ctx);
    expect(startGeneration).toHaveBeenCalledWith(
      { userId: "user-1", projectId: "project-1" },
      expect.objectContaining({
        modelId: "ideogram-v3",
        placementId: "pinterest-pin",
        route: "text_heavy",
        experimentArm: "router:sonnet-5",
        outputFormat: "jpeg",
        seed: 17,
        parentAssetId: null,
        referenceAssetIds: [],
      }),
    );
    expect(result).toMatchObject({
      jobId: "job-1",
      model: "fal-ai/flux-2-pro",
    });
  });

  it("deduplicates replay but separates model comparisons and explicitly requested variants", async () => {
    await generate.execute(base, ctx);
    await generate.execute(base, ctx);
    await generate.execute({ ...base, modelId: "ideogram-v3" }, ctx);
    await generate.execute({ ...base, variant: 2 }, ctx);
    const keys = startGeneration.mock.calls.map(
      (call) => call[1].idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
  });

  it("keeps refinement lineage and references while switching model", async () => {
    const sourceVersionId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    vi.stubEnv("STUDIO_AGENT_ROUTER_TRIAL", "opus");
    await refine.execute(
      {
        ...base,
        sourceVersionId,
        modelId: "gemini-pro",
        placementId: "x-square",
        route: "edit",
      },
      { ...ctx, session: { ...ctx.session, id: "session-2" } },
    );
    expect(startGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parentAssetId: sourceVersionId,
        referenceAssetIds: [sourceVersionId],
        experimentArm: "router:opus-5.5",
        modelId: "gemini-pro",
        placementId: "x-square",
        route: "edit",
      }),
    );
  });

  it("exposes only curated image choices and defaults to Gemini Pro", () => {
    for (const tool of [generate, refine]) {
      const schema = tool.inputSchema;
      if (!(schema instanceof z.ZodObject))
        throw new Error("Expected Zod schema");
      const sourceVersionId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
      const input = { prompt: "A coffee cup icon", sourceVersionId };
      expect(schema.parse(input).modelId).toBe("gemini-pro");
      expect(
        schema.safeParse({ ...input, modelId: "recraft-v4-1-text-to-vector" })
          .success,
      ).toBe(tool === generate);
      for (const modelId of ["gemini-pro", "ideogram-v3"]) {
        expect(schema.safeParse({ ...input, modelId }).success).toBe(true);
      }
      for (const modelId of ["muse-image", "gemini-flash", "flux-2-pro"]) {
        expect(schema.safeParse({ ...input, modelId }).success).toBe(false);
      }
    }
  });

  it("returns only the curated catalog with no paid generation", async () => {
    const catalog = {
      defaultModelId: "muse-image",
      models: [
        { id: "muse-image" },
        { id: "gemini-pro" },
        { id: "ideogram-v3" },
        { id: "flux-2-pro" },
      ],
      placements: [],
    };
    listImageOptions.mockResolvedValue({ catalog });
    expect(await options.execute({}, ctx)).toEqual({
      catalog: {
        ...catalog,
        defaultModelId: "gemini-pro",
        models: [{ id: "gemini-pro" }, { id: "ideogram-v3" }],
      },
    });
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it("looks up the project's products and passes the chosen replacement on an edit", async () => {
    const productId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const sourceVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const catalog = {
      products: [{ id: productId, name: "Clay mug", hasPhoto: true }],
    };
    const identity = { userId: "user-1", projectId: "project-1" };
    listStudioProducts.mockResolvedValueOnce(catalog);
    expect(await products.execute({}, ctx)).toEqual(catalog);
    expect(listStudioProducts).toHaveBeenCalledExactlyOnceWith(identity);
    expect(startGeneration).not.toHaveBeenCalled();

    await refine.execute(
      { ...base, sourceVersionId, catalogProductId: productId },
      ctx,
    );
    expect(startGeneration).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({
        catalogProductId: productId,
        parentAssetId: sourceVersionId,
        referenceAssetIds: [sourceVersionId],
      }),
    );
  });

  it("returns generation provenance and stops on an uncertain provider submission", async () => {
    const settings = { ...base, placementId: "x-square" };
    readGeneration.mockResolvedValue({
      job: {
        id: "job-1",
        status: "SUBMISSION_UNCERTAIN",
        model: "fal-ai/flux-2-pro",
        settings,
        error: null,
        retryMayDuplicateCharge: true,
      },
      version: null,
    });
    const result = await check.execute({ jobId: "job-1" }, ctx);
    expect(result).toMatchObject({
      model: "fal-ai/flux-2-pro",
      settings,
      status: "SUBMISSION_UNCERTAIN",
    });
    expect(result).toHaveProperty(
      "guidance",
      expect.stringContaining("Do not start another generation"),
    );
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it("stops after a vector conversion failure", async () => {
    readGeneration.mockResolvedValue({
      job: { status: "FAILED", failureReason: "invalid_vector_image" },
      version: null,
    });
    expect(await check.execute({ jobId: "job-1" }, ctx)).toMatchObject({
      status: "FAILED",
      guidance: expect.stringContaining("Do not start another generation"),
    });
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it("propagates a refused job without retrying", async () => {
    startGeneration.mockRejectedValue(new Error("Project busy"));
    await expect(generate.execute(base, ctx)).rejects.toThrow("Project busy");
    expect(startGeneration).toHaveBeenCalledTimes(1);
  });
});

describe("non-billed agent behavior contract", () => {
  it("instructs generate-first defaults, intent boundaries, bounded explicit batches and uncertain-submission stop", () => {
    const instructions = readFileSync(
      new URL("../instructions.md", import.meta.url),
      "utf8",
    );
    for (const rule of [
      "generate first with sensible defaults",
      "then suggest improvements",
      "Default to one image",
      "Photos, ads and product scenes: use `generate_image` with `gemini-pro`",
      "Text-heavy images (posters, typography, quotes, infographics with words, signage): use `generate_image` with `ideogram-v3`",
      "Logos, icons and flat diagrams: use `generate_image` with",
      "recraft-v4-1-text-to-vector",
      "Edits to an existing image: use `refine_image`",
      "preserve them unless the person asks for a change",
      "State the chosen route in one short line before or with generation",
      "The ad flow letters an approved headline with Ideogram v3",
      "Never start a second paid job on your own, including for lettering",
      "greetings, critique/review-only",
      "capped at three jobs per turn",
      "submission was not confirmed, **stop**",
      "Use the placement ID in the generation tool",
    ]) {
      expect(instructions.replace(/\s+/g, " ")).toContain(rule);
    }
  });
});

it("reads brand context with only the session identity", async () => {
  const reference = { fonts: ["Inter"] };
  readBrandContext.mockResolvedValueOnce(reference);
  expect(await brandContext.execute({}, ctx)).toEqual(reference);
  expect(readBrandContext).toHaveBeenCalledWith({
    userId: "user-1",
    projectId: "project-1",
  });
});
