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
    aspectRatio: z
      .enum(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"])
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
      idempotencyKey: idempotencyKeyFor(
        ctx,
        `refine:${input.sourceVersionId}:${input.prompt}`,
      ),
    });
    return {
      jobId: job.id,
      status: job.status,
      note: job.note,
      reviewNote:
        "The new version is undecided. It does not inherit the source version's approval.",
    };
  },
});
