import { defineTool } from "eve/tools";
import { z } from "zod";

import { startGeneration } from "../lib/core";
import { idempotencyKeyFor, identityFrom } from "../lib/identity";

export default defineTool({
  description:
    "Make a new version from an existing one, using it as a visual reference. The original is never altered: this always produces a new version, and the new version starts undecided even when the one it came from was approved.",
  inputSchema: z.object({
    sourceVersionId: z
      .string()
      .uuid()
      .describe("The id of the version to refine, from list_versions."),
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe("What should change, and what should stay the same."),
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
  label: { start: ({ prompt }) => `Refine: ${prompt.slice(0, 60)}` },
  async execute(input, ctx) {
    const identity = identityFrom(ctx);
    const { job } = await startGeneration(identity, {
      prompt: input.prompt,
      parentAssetId: input.sourceVersionId,
      // The same version is both the lineage parent and the visual reference.
      referenceAssetIds: [input.sourceVersionId],
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      modelId: input.modelId,
      placementId: input.placementId,
      outputFormat: input.outputFormat,
      seed: input.seed,
      idempotencyKey: idempotencyKeyFor(ctx, `refine:${JSON.stringify(input)}`),
    });
    return {
      jobId: job.id,
      status: job.status,
      model: job.model,
      settings: job.settings,
      note: job.note,
      reviewNote:
        "The new version is undecided. It does not inherit the source version's approval.",
    };
  },
});
