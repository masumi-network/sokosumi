import { z } from "@hono/zod-openapi";

/**
 * Ably `TokenRequest` as returned by `auth.createTokenRequest`.
 *
 * This is handed straight to the Ably client SDK, which exchanges it for a
 * token. It is signed by us but carries no secret — the `mac` is an HMAC over
 * the other fields, so it is safe to return over the wire.
 */
export const ablyTokenRequestSchema = z
  .object({
    keyName: z.string().openapi({ example: "abcdef.ghijkl" }),
    clientId: z.string().openapi({ example: "user_123" }),
    ttl: z.number().int().openapi({ example: 3_600_000 }),
    timestamp: z.number().int().openapi({ example: 1_754_400_000_000 }),
    capability: z.string().openapi({
      description:
        "JSON-encoded capability document scoping the token to this user's channels.",
      example:
        '{"chat_rooms:*:user_123":["subscribe"],"notifications:*:user_123":["subscribe"]}',
    }),
    nonce: z.string().openapi({ example: "1a2b3c4d5e6f7g8h" }),
    mac: z.string().openapi({ example: "9x8y7z6w5v4u3t2s1r=" }),
  })
  .openapi("AblyTokenRequest");

export type AblyTokenRequest = z.infer<typeof ablyTokenRequestSchema>;
