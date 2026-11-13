import { z } from "@hono/zod-openapi";

const confidenceIntervalSchema = z.object({
  lower: z.number(),
  upper: z.number(),
});

export const adEvalsLeaderboardRowSchema = z
  .object({
    model: z.string(),
    template: z.string().nullable(),
    aspect: z.string().nullable(),
    workspaceCount: z.number().int().nonnegative(),
    suppressed: z.boolean(),
    n: z.number().int().nonnegative(),
    thumbN: z.number().int().nonnegative(),
    pairwiseN: z.number().int().nonnegative(),
    judgeN: z.number().int().nonnegative(),
    thumbRate: z.number().min(0).max(1).nullable(),
    pairwiseWinRate: z.number().min(0).max(1).nullable(),
    judgeMean: z.number().min(1).max(5).nullable(),
    thumbRateCi: confidenceIntervalSchema.nullable(),
    pairwiseWinRateCi: confidenceIntervalSchema.nullable(),
    judgeMeanCi: confidenceIntervalSchema.nullable(),
  })
  .openapi("AdEvalsLeaderboardRow");

export const adEvalsAgreementRowSchema = z
  .object({
    criterion: z.string(),
    signal: z.enum(["thumb", "pairwise"]),
    rho: z.number().min(-1).max(1).nullable(),
    n: z.number().int().nonnegative(),
    lowAgreement: z.boolean(),
  })
  .openapi("AdEvalsAgreementRow");

export const adminAdEvalsDashboardSchema = z
  .object({
    leaderboard: z.array(adEvalsLeaderboardRowSchema),
    agreement: z.array(adEvalsAgreementRowSchema),
    minimumWorkspaces: z.number().int().positive(),
  })
  .openapi("AdminAdEvalsDashboard");
