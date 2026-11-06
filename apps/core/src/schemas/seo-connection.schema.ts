import { z } from "@hono/zod-openapi";

export const seoConnectionProviderSchema = z.enum(["ga4", "search_console"]);
export type SeoConnectionProvider = z.infer<typeof seoConnectionProviderSchema>;
export const SEO_CONNECTION_PROVIDERS = {
  ga4: { toolkit: "google_analytics", name: "Google Analytics" },
  search_console: { toolkit: "google_search_console", name: "Search Console" },
} as const;
export const seoConnectionParamsSchema = z.object({
  provider: seoConnectionProviderSchema,
});
export const seoConnectionStatusSchema = z
  .object({
    provider: seoConnectionProviderSchema,
    name: z.string(),
    status: z.enum([
      "not_connected",
      "pending",
      "connected",
      "needs_reconnect",
      "unavailable",
    ]),
    source: z.enum(["native", "personal", "none"]),
    pendingConnectionId: z.string().nullable().optional(),
    canResume: z.boolean().optional(),
  })
  .openapi("SeoConnectionStatus");
export const connectSeoConnectionSchema = z
  .object({ callbackUrl: z.url().optional() })
  .strict()
  .openapi("ConnectSeoConnectionRequest");
export const connectSeoConnectionResponseSchema = z
  .object({ connectionId: z.string(), redirectUrl: z.url() })
  .openapi("ConnectSeoConnectionResponse");
export const finalizeSeoConnectionSchema = z
  .object({
    connectionId: z.string().min(1).max(200).optional(),
    sessionUri: z.string().min(1).max(8_192).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.connectionId || value.sessionUri), {
    message: "A connection or provider callback is required",
  })
  .openapi("FinalizeSeoConnectionRequest");
export const disconnectSeoConnectionSchema = z
  .object({ disconnected: z.literal(true) })
  .openapi("DisconnectSeoConnectionResponse");
