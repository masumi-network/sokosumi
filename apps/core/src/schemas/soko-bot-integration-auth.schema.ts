import { z } from "@hono/zod-openapi";

export const completeSokoBotIntegrationAuthRequestSchema = z
  .object({
    sessionUri: z
      .string()
      .min(1)
      .max(2048)
      .describe("The single-use session URI Composio hands to the verifier"),
  })
  .openapi("CompleteSokoBotIntegrationAuthRequest");

export const completeSokoBotIntegrationAuthResponseSchema = z
  .object({
    provider: z.string(),
    status: z.enum(["DISCONNECTED", "PENDING", "ACTIVE", "FAILED", "REVOKED"]),
  })
  .openapi("CompleteSokoBotIntegrationAuthResponse");
