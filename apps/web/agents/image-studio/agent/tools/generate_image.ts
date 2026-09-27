import { defineTool } from "eve/tools";
import { z } from "zod";

import { startGeneration } from "../lib/core";
import { idempotencyKeyFor, identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "Generate a new image from a description. Use this for a genuinely new idea. To change an image that already exists, use refine_image instead so the original is preserved and the lineage stays intact.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe(
        "What to make: subject, composition, lighting, mood, and what to leave out.",
      ),
    variant: z
      .number()
      .int()
      .min(1)
      .max(3)
      .default(1)
      .describe(
        "Requested variant index within this turn; use 1 unless the user requested multiple images.",
      ),
    modelId: z
      .enum(["gemini-flash", "gemini-pro", "flux-2-pro"])
      .default("gemini-flash")
      .describe(
        "Supported Studio model. Consult list_image_options for capabilities; never invent endpoints.",
      ),
    placementId: z
      .string()
      .nullable()
      .default(null)
      .describe(
        "Placement ID from list_image_options or the user's selected target context. Core applies its aspect ratio.",
      ),
    outputFormat: z.enum(["png", "jpeg", "webp"]).default("png"),
    seed: z.number().int().min(0).max(2147483647).nullable().default(null),
    aspectRatio: z
      .enum(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "4:5", "5:4"])
      .default("1:1"),
    resolution: z.enum(["0.5K", "1K", "2K"]).default("1K"),
  }),
  label: { start: ({ prompt }) => `Generate: ${prompt.slice(0, 60)}` },
  async execute(input, ctx) {
    const identity = identityFrom(ctx);
    const { job } = await startGeneration(identity, {
      prompt: input.prompt,
      parentAssetId: null,
      referenceAssetIds: [],
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      modelId: input.modelId,
      placementId: input.placementId,
      outputFormat: input.outputFormat,
      seed: input.seed,
      idempotencyKey: idempotencyKeyFor(
        ctx,
        `generate:${JSON.stringify(input)}`,
      ),
    });
    return {
      jobId: job.id,
      status: job.status,
      model: job.model,
      settings: job.settings,
      note: job.note,
    };
  },
});
