import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const oauthConsentSchema = z
  .object({
    id: z.string().openapi({ example: "consent_123" }),
    clientId: z.string().openapi({ example: "client_abc" }),
    scopes: z.array(z.string()).openapi({ example: ["openid", "profile"] }),
    createdAt: dateTimeSchema,
  })
  .openapi("OAuthConsent");

export const oauthConsentsSchema = z.array(oauthConsentSchema);
