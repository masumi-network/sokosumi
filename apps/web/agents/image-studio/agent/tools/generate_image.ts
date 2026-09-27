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
    aspectRatio: z
      .enum(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"])
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
      idempotencyKey: idempotencyKeyFor(ctx, `generate:${input.prompt}`),
    });
    return {
      jobId: job.id,
      status: job.status,
      note: job.note,
    };
  },
});
