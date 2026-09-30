import { z } from "@hono/zod-openapi";

import {
  PROJECT_AD_PROVIDERS,
  type ProjectAdProvider,
} from "@/config/ads-providers";
import { dateTimeSchema } from "@/helpers/datetime";
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";

export const projectAdProviderSchema = z
  .enum(Object.keys(PROJECT_AD_PROVIDERS) as ProjectAdProvider[])
  .openapi("ProjectAdProvider", { example: "google_ads" });

export const projectAdAccountParamsSchema =
  projectSocialConnectionProjectParamsSchema.extend({
    accountId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "accountId", in: "path" },
        example: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      }),
  });

export const projectAdConnectionStatusSchema = z.enum([
  "active",
  "reauthorization_required",
  "disconnected",
]);

export const projectAdConnectionSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Pass this as `adConnectionId` when attaching accounts",
      example: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
    }),
    provider: projectAdProviderSchema,
    status: projectAdConnectionStatusSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectAdConnection");

const availableAdAccountFields = {
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
};

export const availableAdAccountSchema = z
  .object(availableAdAccountFields)
  .openapi("AvailableAdAccount");

export const projectAdAccountSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    provider: projectAdProviderSchema,
    ...availableAdAccountFields,
    loginCustomerId: z.string().nullable().openapi({
      description: "Google manager account reaching this account, if any",
    }),
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectAdAccount");

export const initiateProjectAdConnectionRequestSchema = z
  .object({ provider: projectAdProviderSchema })
  .openapi("InitiateProjectAdConnectionRequest");

export const finalizeProjectAdConnectionResponseSchema = z
  .object({
    connection: projectAdConnectionSchema.nullable().openapi({
      description:
        "Null when the account reaches no ad accounts: nothing is stored and the authorization is revoked",
    }),
    availableAccounts: z.array(availableAdAccountSchema),
  })
  .openapi("FinalizeProjectAdConnectionResponse");

export const attachProjectAdAccountsRequestSchema = z
  .object({
    adConnectionId: z.string().uuid().openapi({
      description: "The connection `id` returned by finalize",
    }),
    externalAccountIds: z.array(z.string().min(1)).min(1).max(50),
  })
  .openapi("AttachProjectAdAccountsRequest");
