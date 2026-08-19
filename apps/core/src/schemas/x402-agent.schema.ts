import { z } from "@hono/zod-openapi";

/**
 * Response shapes for the authenticated x402 agent listing. User actors
 * include sessions, Better Auth API keys, and OAuth tokens; direct coworker
 * agents can also read it (`GET /v1/agents/x402`, PR1-SPEC §2).
 *
 * Fixed entries preserve Listed ⇒ payable. Dynamic entries are payable when
 * their network has a priced node-ready asset; otherwise both actor types may
 * still discover them as explicitly non-payable previews.
 */
export const x402FixedAgentPaymentSourceSchema = z
  .object({
    caip2Network: z.string().openapi({
      example: "eip155:84532",
      description: "CAIP-2 EVM network id the agent accepts payment on",
    }),
    asset: z.string().openapi({
      example: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      description: "ERC-20 contract address of the accepted asset (lowercase)",
    }),
    // Filled from `X402ReadySource.decimals` (the node's
    // `defaultAssetDecimals`), NOT from the agent's `AgentPaymentSourceAmount`
    // row. The scale divides the charge, so swapping the two back would let an
    // agent registering 18 for 6-decimals USDC be charged 10^12 too little for
    // a token Soko's managed wallet really signs away. Say so in the published
    // description too: an integrator told this field is agent-authored has no
    // reason to leave the safe source in place.
    decimals: z.number().int().openapi({
      example: 6,
      description:
        "Base units per whole token for this (network, asset) pair, as the Sokosumi payment node publishes it — never the scale the agent registered. It is the scale `credits` was computed at.",
    }),
    payTo: z.string().openapi({
      example: "0x1111111111111111111111111111111111111111",
      description: "Recipient address the agent's 402 will demand",
    }),
    amount: z.string().openapi({
      example: "250000",
      description: "Advertised price in chain-native base units",
    }),
    credits: z.number().openapi({
      example: 0.5,
      description:
        "Advertised price converted to Sokosumi credits (charge-floored)",
    }),
  })
  .openapi("X402FixedAgentPaymentSource");

export type X402FixedAgentPaymentSource = z.infer<
  typeof x402FixedAgentPaymentSourceSchema
>;

export const x402DynamicAgentPaymentSourceSchema = z
  .object({
    pricingType: z.literal("dynamic").openapi({ example: "dynamic" }),
    caip2Network: z.string().openapi({
      example: "eip155:84532",
      description: "CAIP-2 EVM network the dynamic source advertises",
    }),
    payTo: z.string().openapi({
      example: "0x1111111111111111111111111111111111111111",
      description: "Recipient address the dynamic source advertises",
    }),
  })
  .openapi("X402DynamicAgentPaymentSource");

export type X402DynamicAgentPaymentSource = z.infer<
  typeof x402DynamicAgentPaymentSourceSchema
>;

const x402AgentBaseSchema = z.object({
  id: z.string().openapi({ example: "cmaeygqwa000e8i0s9s7wif8i" }),
  specification: z.enum(["bazaar", "openapi"]).openapi({
    example: "bazaar",
    description:
      "Registry entry specification: an x402/Bazaar manifest or an OpenAPI agent advertising x402 payment sources",
  }),
  name: z.string().openapi({ example: "Bazaar Research Agent" }),
  description: z.string().nullable().openapi({
    example: "A research agent payable via x402",
  }),
  image: z
    .string()
    .nullable()
    .openapi({ example: "https://example.com/image.png" }),
  // Absolute HTTP(S) enforced at the schema too, not only by the route's
  // `hasValidX402DiscoveryUrl` drop: a future producer bypassing the route
  // gate must still fail parse instead of publishing an arbitrary string.
  x402ResourcesUrl: z.httpUrl().nullable().openapi({
    example: "https://agent.example.com/.well-known/x402",
    description:
      "The agent's advertised x402 resources index, always an absolute HTTP(S) URL. Non-null exactly when `specification` is `bazaar`; null for OpenAPI entries.",
  }),
  openApiSpecUrl: z.httpUrl().nullable().openapi({
    example: "https://agent.example.com/openapi.json",
    description:
      "The agent's advertised OpenAPI document, always an absolute HTTP(S) URL. Non-null exactly when `specification` is `openapi`; null for Bazaar entries.",
  }),
});

const x402FixedAgentSchema = x402AgentBaseSchema.extend({
  pricingType: z.literal("fixed"),
  isPayable: z.literal(true),
  paymentSources: z.array(x402FixedAgentPaymentSourceSchema).min(1).openapi({
    description:
      "Payment sources Sokosumi can pay right now (fail-closed filtered)",
  }),
});

const x402DynamicAgentSchema = x402AgentBaseSchema.extend({
  pricingType: z.literal("dynamic"),
  isPayable: z.boolean().openapi({
    description:
      "Whether this deployment currently has a priced buy-side-ready asset on every advertised dynamic network. Runtime payment still requires maxCredits and verifies the 402's actual asset.",
  }),
  paymentSources: z.array(x402DynamicAgentPaymentSourceSchema).min(1).openapi({
    description:
      "Dynamic sources whose runtime 402 quote can use the coworker payment endpoint with a mandatory maxCredits ceiling.",
  }),
});

const x402MixedAgentSchema = x402AgentBaseSchema.extend({
  pricingType: z.literal("mixed"),
  isPayable: z.boolean().openapi({
    description:
      "Whether every fixed and dynamic payment source is currently payable on this deployment. Mixed agents remain visible as previews when a dynamic source is not buy-side ready.",
  }),
  paymentSources: z
    .array(
      z.union([
        x402FixedAgentPaymentSourceSchema,
        x402DynamicAgentPaymentSourceSchema,
      ]),
    )
    .min(2)
    .openapi({
      description:
        "Fixed and dynamic payment sources advertised by one agent. Runtime verification preserves fixed ceilings when registrations overlap.",
    }),
});

export const x402AgentSchema = z
  .discriminatedUnion("pricingType", [
    x402FixedAgentSchema,
    x402DynamicAgentSchema,
    x402MixedAgentSchema,
  ])
  .openapi("X402Agent");

export type X402Agent = z.infer<typeof x402AgentSchema>;

export const x402AgentsSchema = z.array(x402AgentSchema);
