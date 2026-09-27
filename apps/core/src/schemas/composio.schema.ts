import { z } from "@hono/zod-openapi";

export const completeComposioCallbackRequestSchema = z
  .object({
    connectionId: z.string().min(1),
    // Opaque one-use credential, not necessarily a URL. Used only for redemption;
    // never persisted or included in a response.
    sessionUri: z.string().min(1),
  })
  .openapi("CompleteComposioCallbackRequest");

export const completeComposioCallbackResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("CompleteComposioCallbackResponse");
