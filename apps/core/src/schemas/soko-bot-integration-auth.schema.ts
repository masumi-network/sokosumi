import { z } from "@hono/zod-openapi";

export const completeSokoBotIntegrationAuthRequestSchema = z
  .object({
    // Deliberately unbounded beyond non-empty: the value is opaque and minted
    // upstream, so a guessed length cap would fail every connect if it grew.
    sessionUri: z
      .string()
      .min(1)
      .describe("The single-use session URI Composio hands to the verifier"),
  })
  .openapi("CompleteSokoBotIntegrationAuthRequest");

export const completeSokoBotIntegrationAuthResponseSchema = z
  .object({
    provider: z.string(),
    status: z.enum(["DISCONNECTED", "PENDING", "ACTIVE", "FAILED", "REVOKED"]),
  })
  .openapi("CompleteSokoBotIntegrationAuthResponse");
