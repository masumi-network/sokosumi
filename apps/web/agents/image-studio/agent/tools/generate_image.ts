import { defineTool } from "eve/tools";
import { z } from "zod";

import { startGeneration } from "../lib/core";
import { idempotencyKeyFor, identityFrom } from "../lib/identity";
import { CURATED_IMAGE_MODEL_IDS, pinnedSelectionFrom } from "../lib/models";

export default defineTool({
  description:
    "Generate a new image from a description. Use this for a genuinely new idea. To change an image that already exists, use refine_image instead so the original is preserved and the lineage stays intact.",
  inputSchema: z.object({
    catalogProductId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Use a saved product id from list_products when the user wants to feature that product. Core applies its approved details and photo.",
      ),
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
      .enum(CURATED_IMAGE_MODEL_IDS)
      .default("gemini-pro")
      .describe(
        "Use gemini-pro for images and ads; ideogram-v3 for text-heavy images. An Advanced model selection overrides this choice.",
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
    const selection = { ...input, ...pinnedSelectionFrom(ctx) };
    const { job } = await startGeneration(identity, {
      prompt: input.prompt,
      parentAssetId: null,
      referenceAssetIds: [],
      aspectRatio: selection.aspectRatio,
      resolution: selection.resolution,
      modelId: selection.modelId,
      ...(input.catalogProductId
        ? { catalogProductId: input.catalogProductId }
        : {}),
      placementId: input.placementId,
      outputFormat: selection.outputFormat,
      seed: selection.seed,
      idempotencyKey: idempotencyKeyFor(
        ctx,
        `generate:${JSON.stringify(selection)}`,
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
