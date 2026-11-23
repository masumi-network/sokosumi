import { defineTool } from "eve/tools";
import { z } from "zod";

import { drawSvg } from "../lib/core";
import { idempotencyKeyFor, identityFrom } from "../lib/identity";
import { studioRouterForSession } from "../lib/router-trial";

export default defineTool({
  description:
    "Draw a geometric logo, icon or diagram as plain SVG. Core renders a PNG at the SVG's dimensions.",
  inputSchema: z.object({
    svg: z
      .string()
      .min(1)
      .max(128 * 1024),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("A short plain-text description of the artwork."),
    placementId: z.string().min(1).max(100).nullish(),
    aspectRatio: z
      .enum(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "4:5", "5:4"])
      .default("1:1"),
    variant: z.number().int().min(1).max(3).default(1),
  }),
  label: { start: () => "Draw graphic" },
  async execute(input, ctx) {
    const { id, status, model, settings } = await drawSvg(identityFrom(ctx), {
      svg: input.svg,
      prompt: input.prompt,
      placementId: input.placementId,
      aspectRatio: input.aspectRatio,
      experimentArm: studioRouterForSession(ctx.session.id).arm,
      idempotencyKey: idempotencyKeyFor(
        ctx,
        `draw_svg:${JSON.stringify(input)}`,
      ),
    });
    const note =
      status === "SUCCEEDED"
        ? "The PNG is ready."
        : status === "RUNNING"
          ? "The drawing is being rendered."
          : "The drawing failed. Stop here without starting another job.";
    return { jobId: id, status, model, settings, note };
  },
});
