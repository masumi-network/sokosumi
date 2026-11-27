import { ImageStudioRoute } from "@sokosumi/core-client";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { startGeneration } from "../lib/core";
import { idempotencyKeyFor, identityFrom } from "../lib/identity";
import { CURATED_IMAGE_MODEL_IDS } from "../lib/models";
import { studioRouterForSession } from "../lib/router-trial";

export default defineTool({
  description:
    "Generate a new image from a description. Use this for a genuinely new idea. To change an image that already exists, use refine_image instead so the original is preserved and the lineage stays intact.",
  inputSchema: z.object({
    route: z.enum(ImageStudioRoute).optional(),
    brandAssetIds: z
      .array(z.uuid())
      .max(4)
      .optional()
      .describe(
        "Relevant image IDs from read_brand_context. Use gemini-pro with references; allow four total, including the source version and product photo.",
      ),
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
        "Use gemini-pro for images and ads; ideogram-v3 for text-heavy images. Use recraft-v4-1-text-to-vector only for logos, icons and flat diagrams, with PNG output and no seed.",
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
      route: input.route,
      experimentArm: studioRouterForSession(ctx.session.id).arm,
      parentAssetId: null,
      referenceAssetIds: [],
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      modelId: input.modelId,
      ...(input.brandAssetIds?.length
        ? { brandAssetIds: input.brandAssetIds }
        : {}),
      ...(input.catalogProductId
        ? { catalogProductId: input.catalogProductId }
        : {}),
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
