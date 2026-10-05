import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { startGeneration, listImageOptions, readGeneration } = vi.hoisted(
  () => ({
    startGeneration: vi.fn(),
    listImageOptions: vi.fn(),
    readGeneration: vi.fn(),
  }),
);
vi.mock("../lib/core", () => ({
  startGeneration,
  listImageOptions,
  readGeneration,
}));

import check from "./check_generation";
import generate from "./generate_image";
import options from "./list_image_options";
import refine from "./refine_image";

// These tools use only session identity and turn ID from the runtime context.
// eve@0.68 ToolContext has no `messages` — do not add until eve is bumped.
const ctx: Parameters<typeof generate.execute>[1] = {
  getSandbox: vi.fn(),
  getToken: vi.fn(),
  requireAuth: () => {
    throw new Error("Unexpected auth request");
  },
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
  modelId: "gemini-flash" as const,
  aspectRatio: "1:1" as const,
  resolution: "1K" as const,
  outputFormat: "png" as const,
  seed: null,
  placementId: null,
  variant: 1,
};

describe("image generation tools", () => {
  beforeEach(() => {
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

  it("forwards chosen model, placement, output format and seed to Core without changing scope", async () => {
    const input = {
      ...base,
      modelId: "flux-2-pro" as const,
      placementId: "pinterest-pin",
      outputFormat: "jpeg" as const,
      seed: 17,
    };
    const result = await generate.execute(input, ctx);
    expect(startGeneration).toHaveBeenCalledWith(
      { userId: "user-1", projectId: "project-1" },
      expect.objectContaining({
        modelId: "flux-2-pro",
        placementId: "pinterest-pin",
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
    await generate.execute({ ...base, modelId: "gemini-pro" }, ctx);
    await generate.execute({ ...base, variant: 2 }, ctx);
    const keys = startGeneration.mock.calls.map(
      (call) => call[1].idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
  });

  it("keeps refinement lineage and references while switching model", async () => {
    const sourceVersionId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    await refine.execute(
      {
        ...base,
        sourceVersionId,
        modelId: "gemini-pro",
        placementId: "x-square",
      },
      ctx,
    );
    expect(startGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parentAssetId: sourceVersionId,
        referenceAssetIds: [sourceVersionId],
        modelId: "gemini-pro",
        placementId: "x-square",
      }),
    );
  });

  it("returns the Core catalog with no paid generation", async () => {
    const catalog = {
      defaultModelId: "gemini-flash",
      models: [{ id: "gemini-flash" }],
      placements: [],
    };
    listImageOptions.mockResolvedValue({ catalog });
    expect(await options.execute({}, ctx)).toEqual({ catalog });
    expect(startGeneration).not.toHaveBeenCalled();
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
      "greetings, critique/review-only",
      "capped at three jobs per turn",
      "submission was not confirmed, **stop**",
      "Use the placement ID in the generation tool",
    ]) {
      expect(instructions).toContain(rule);
    }
  });
});
