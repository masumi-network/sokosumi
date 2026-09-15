import { z } from "@hono/zod-openapi";

export const completeComposioCallbackRequestSchema = z
  .object({
    connectionId: z.string().min(1),
    // One-use callback credential. It is accepted only to redeem this request
    // and is never persisted or included in a response.
    sessionUri: z.url(),
  })
  .openapi("CompleteComposioCallbackRequest");

export const completeComposioCallbackResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("CompleteComposioCallbackResponse");
