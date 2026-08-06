import { z } from "@hono/zod-openapi";

/** Ably TokenRequest fields used by Realtime clients (authCallback / authUrl). */
export const ablyTokenRequestSchema = z
  .object({
    keyName: z.string().openapi({ example: "appId.keyId" }),
    ttl: z.number().int().optional().openapi({ example: 3_600_000 }),
    capability: z.string().openapi({
      example: '{"chat_rooms:room_abc":["subscribe"]}',
    }),
    clientId: z.string().optional().openapi({ example: "user_123" }),
    timestamp: z.number().int().openapi({ example: 1_704_067_200_000 }),
    nonce: z.string().openapi({ example: "random-nonce" }),
    mac: z.string().openapi({ example: "signature" }),
  })
  .openapi("AblyTokenRequest");

export type AblyTokenRequest = z.infer<typeof ablyTokenRequestSchema>;
