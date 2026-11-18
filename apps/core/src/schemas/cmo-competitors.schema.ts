import { z } from "@hono/zod-openapi";

import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import {
  competitorIdParam,
  projectCompetitorsShape,
} from "@/schemas/project-competitors.schema";

export const cmoCompetitorParamsSchema = cmoProjectParamsSchema.extend({
  competitorId: competitorIdParam,
});

/** Cuso's Competitors tab: his Project's page and his market map's players. */
export const cmoCompetitorsSchema = z
  .object({
    ...projectCompetitorsShape,
    mapPlayers: z
      .array(z.string())
      .describe(
        "The Brand Brain market map's players that are still watched, in the map's spelling.",
      ),
  })
  .openapi("CmoCompetitors");

export const cmoCompetitorFeedItemParamsSchema = cmoProjectParamsSchema.extend({
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: "itemId", in: "path" } }),
});
