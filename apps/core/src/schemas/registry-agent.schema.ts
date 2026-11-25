import { z } from "@hono/zod-openapi";
import type { RegistryEntry } from "@sokosumi/masumi";

import { dateTimeSchema } from "@/helpers/datetime";

export const REGISTRY_AGENT_STATUSES = [
  "Online",
  "Offline",
  "Deregistered",
  "Invalid",
] as const;

const registryAgentPricingSchema = z
  .discriminatedUnion("pricingType", [
    z.object({
      pricingType: z.literal("Fixed"),
      amounts: z.array(
        z.object({
          amount: z.string().openapi({ example: "1000000" }),
          unit: z.string().openapi({ example: "lovelace" }),
        }),
      ),
    }),
    z.object({ pricingType: z.literal("Free") }),
    z.object({ pricingType: z.literal("Dynamic") }),
  ])
  .openapi("RegistryAgentPricing");

// The generated client types AgentPricing as `unknown`, so its shape is
// checked here instead of trusted.
const registryPricingInputSchema = z.union([
  z
    .object({
      pricingType: z.literal("Fixed"),
      FixedPricing: z.object({
        Amounts: z.array(z.object({ amount: z.string(), unit: z.string() })),
      }),
    })
    .transform((pricing) => ({
      pricingType: "Fixed" as const,
      amounts: pricing.FixedPricing.Amounts.map(({ amount, unit }) => ({
        amount,
        unit,
      })),
    })),
  z
    .object({ pricingType: z.enum(["Free", "Dynamic"]) })
    .transform((pricing) => ({ pricingType: pricing.pricingType })),
]);

export const registryAgentSchema = z
  .object({
    id: z.string().openapi({
      description: "Registry entry id. Use it as the pagination cursor.",
    }),
    agentIdentifier: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(REGISTRY_AGENT_STATUSES),
    statusUpdatedAt: dateTimeSchema,
    type: z.enum(["Standard", "OpenApi", "X402"]),
    paymentType: z.enum(["Web3CardanoV1", "Web3CardanoV2", "None"]),
    apiBaseUrl: z.string().nullable(),
    openApiSpecUrl: z.string().nullable(),
    x402ResourcesUrl: z.string().nullable(),
    image: z.string().nullable(),
    tags: z.array(z.string()),
    capability: z
      .object({ name: z.string().nullable(), version: z.string().nullable() })
      .nullable(),
    author: z.object({
      name: z.string().nullable(),
      organization: z.string().nullable(),
      contactEmail: z.string().nullable(),
      contactOther: z.string().nullable(),
    }),
    legal: z.object({
      privacyPolicy: z.string().nullable(),
      terms: z.string().nullable(),
      other: z.string().nullable(),
    }),
    pricing: registryAgentPricingSchema.nullable().openapi({
      description:
        "Null when the registry sends a pricing shape Core does not know.",
    }),
    uptime: z.object({
      count: z.number().int(),
      checkCount: z.number().int(),
      lastCheckedAt: dateTimeSchema,
    }),
    policyId: z.string().nullable(),
    supersedesAgentIdentifier: z.string().nullable(),
    supersededByAgentIdentifier: z.string().nullable(),
    createdAt: dateTimeSchema,
  })
  .openapi("RegistryAgent");

export type RegistryAgent = z.input<typeof registryAgentSchema>;

export function mapRegistryAgentForApi(entry: RegistryEntry): RegistryAgent {
  const pricing = registryPricingInputSchema.safeParse(entry.AgentPricing);

  return {
    id: entry.id,
    agentIdentifier: entry.agentIdentifier,
    name: entry.name,
    description: entry.description,
    status: entry.status,
    statusUpdatedAt: entry.statusUpdatedAt,
    type: entry.type,
    paymentType: entry.paymentType,
    apiBaseUrl: entry.apiBaseUrl,
    openApiSpecUrl: entry.openApiSpecUrl,
    x402ResourcesUrl: entry.x402ResourcesUrl,
    image: entry.image,
    tags: entry.tags ?? [],
    capability: entry.Capability,
    author: {
      name: entry.authorName,
      organization: entry.authorOrganization,
      contactEmail: entry.authorContactEmail,
      contactOther: entry.authorContactOther,
    },
    legal: {
      privacyPolicy: entry.privacyPolicy,
      terms: entry.termsAndCondition,
      other: entry.otherLegal,
    },
    pricing: pricing.success ? pricing.data : null,
    uptime: {
      count: entry.uptimeCount,
      checkCount: entry.uptimeCheckCount,
      lastCheckedAt: entry.lastUptimeCheck,
    },
    policyId: entry.RegistrySource.policyId,
    supersedesAgentIdentifier: entry.supersedesAgentIdentifier,
    supersededByAgentIdentifier: entry.supersededByAgentIdentifier,
    createdAt: entry.createdAt,
  };
}
