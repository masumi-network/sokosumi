import { z } from "@hono/zod-openapi";

import {
  imageStudioAssetSchema,
  imageStudioProjectParamsSchema,
} from "./project-image-studio.schema";

export const studioCompareParamsSchema = imageStudioProjectParamsSchema.extend({
  batchId: z.uuid(),
});

export const studioPairOutcomeSchema = z
  .enum(["A", "B", "TIE", "BOTH_BAD"])
  .openapi("StudioPairOutcome");

export const saveStudioPairwisePickSchema = z
  .object({
    assetId: z.uuid(),
    otherAssetId: z.uuid(),
    outcome: studioPairOutcomeSchema,
  })
  .openapi("SaveStudioPairwisePick");

export const studioPairwisePickSchema = saveStudioPairwisePickSchema
  .extend({ id: z.uuid() })
  .openapi("StudioPairwisePick");

export const studioComparePairSchema = z
  .object({ a: imageStudioAssetSchema, b: imageStudioAssetSchema })
  .openapi("StudioComparePair");

export const studioCompareStateSchema = z
  .object({ pair: z.union([studioComparePairSchema, z.null()]) })
  .openapi("StudioCompareState");

export const studioModelScoreboardSchema = z
  .object({
    models: z.array(
      z.object({
        model: z.string(),
        comparisons: z.number().int().positive(),
        winRate: z.number().min(0).max(1),
        elo: z.number(),
        provisional: z.boolean(),
      }),
    ),
    minimumComparisons: z.number().int().positive(),
  })
  .openapi("StudioModelScoreboard");
