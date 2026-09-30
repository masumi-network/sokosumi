import { z } from "@hono/zod-openapi";

import {
  PROJECT_AD_PROVIDERS,
  type ProjectAdProvider,
} from "@/config/ads-providers";
import { dateTimeSchema } from "@/helpers/datetime";

export const projectAdProviderSchema = z
  .enum(Object.keys(PROJECT_AD_PROVIDERS) as ProjectAdProvider[])
  .openapi("ProjectAdProvider", { example: "google_ads" });

export const projectAdProjectParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

export const projectAdAccountParamsSchema = projectAdProjectParamsSchema.extend(
  {
    accountId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "accountId", in: "path" },
        example: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      }),
  },
);

export const projectAdConnectionSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Pass this as `connectionId` when attaching accounts",
      example: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
    }),
    provider: projectAdProviderSchema,
    status: z.enum(["active", "reauthorization_required", "disconnected"]),
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectAdConnection");

const adAccountFields = {
  externalAccountId: z.string().openapi({
    description: "Google customer id or Meta `act_…` id",
    example: "1234567890",
  }),
  name: z.string().openapi({ example: "Sokosumi Ads" }),
  currency: z.string().openapi({
    description: "ISO 4217 code; money is a decimal in this currency",
    example: "EUR",
  }),
  timeZone: z.string().nullable().openapi({ example: "Europe/Berlin" }),
  loginCustomerId: z.string().nullable().openapi({
    description: "Google manager account reaching this account, if any",
  }),
};

export const availableAdAccountSchema = z
  .object(adAccountFields)
  .openapi("AvailableAdAccount");

export const projectAdAccountSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    provider: projectAdProviderSchema,
    ...adAccountFields,
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectAdAccount");

export const initiateProjectAdConnectionRequestSchema = z
  .object({ provider: projectAdProviderSchema })
  .openapi("InitiateProjectAdConnectionRequest");

export const initiateProjectAdConnectionResponseSchema = z
  .object({
    connectionId: z.string().min(1).openapi({ example: "ca_123" }),
    redirectUrl: z.url().openapi({
      example: "https://connect.composio.dev/link-token",
    }),
  })
  .openapi("InitiateProjectAdConnectionResponse");

export const finalizeProjectAdConnectionRequestSchema = z
  .object({
    connectionId: z.string().min(1).openapi({
      description: "The `connectionId` returned by initiate",
      example: "ca_123",
    }),
  })
  .openapi("FinalizeProjectAdConnectionRequest");

export const finalizeProjectAdConnectionResponseSchema = z
  .object({
    connection: projectAdConnectionSchema,
    availableAccounts: z.array(availableAdAccountSchema),
  })
  .openapi("FinalizeProjectAdConnectionResponse");

export const attachProjectAdAccountsRequestSchema = z
  .object({
    connectionId: z.string().uuid().openapi({
      description: "The connection `id` returned by finalize",
    }),
    externalAccountIds: z.array(z.string().min(1)).min(1).max(50),
  })
  .openapi("AttachProjectAdAccountsRequest");
