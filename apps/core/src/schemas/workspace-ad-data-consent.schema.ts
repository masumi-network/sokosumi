import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";

export const WORKSPACE_AD_DATA_POLICY_VERSION = "2026-11-13";

export const workspaceAdDataConsentWriteSchema = z
  .object({
    shareForImprovement: z.boolean(),
    allowTraining: z.boolean(),
  })
  .refine((value) => !value.allowTraining || value.shareForImprovement, {
    path: ["allowTraining"],
    message: "Training use requires sharing for improvement",
  })
  .openapi("WorkspaceAdDataConsentWrite");

export const workspaceAdDataConsentSchema = z
  .object({
    workspaceId: z.uuid(),
    shareForImprovement: z.boolean(),
    allowTraining: z.boolean(),
    decidedAt: dateTimeSchema.nullable(),
    policyVersion: z.string(),
  })
  .openapi("WorkspaceAdDataConsent");
