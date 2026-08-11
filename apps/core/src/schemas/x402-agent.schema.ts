import { z } from "@hono/zod-openapi";

/**
 * Response shapes for the coworker-gated x402 agent listing
 * (`GET /v1/agents/x402`, PR1-SPEC §2). Listed ⇒ payable: every payment
 * source shown here has passed the fail-closed gates (priced CreditCost row,
 * per-environment network allowlist, buy-side-ready pair), so a coworker can
 * forward any 402 matching one of these sources to the pay endpoint.
 */
export const x402AgentPaymentSourceSchema = z
  .object({
    caip2Network: z.string().openapi({
      example: "eip155:84532",
      description: "CAIP-2 EVM network id the agent accepts payment on",
    }),
    asset: z.string().openapi({
      example: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      description: "ERC-20 contract address of the accepted asset (lowercase)",
    }),
    decimals: z.number().int().openapi({
      example: 6,
      description: "Asset decimals from the agent's registry entry",
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
  .openapi("X402AgentPaymentSource");

export type X402AgentPaymentSource = z.infer<
  typeof x402AgentPaymentSourceSchema
>;

export const x402AgentSchema = z
  .object({
    id: z.string().openapi({ example: "cmaeygqwa000e8i0s9s7wif8i" }),
    name: z.string().openapi({ example: "Bazaar Research Agent" }),
    description: z.string().nullable().openapi({
      example: "A research agent payable via x402",
    }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/image.png" }),
    x402ResourcesUrl: z.string().nullable().openapi({
      example: "https://agent.example.com/.well-known/x402",
      description: "The agent's advertised x402 resources index",
    }),
    paymentSources: z.array(x402AgentPaymentSourceSchema).min(1).openapi({
      description:
        "Payment sources Sokosumi can pay right now (fail-closed filtered)",
    }),
  })
  .openapi("X402Agent");

export type X402Agent = z.infer<typeof x402AgentSchema>;

export const x402AgentsSchema = z.array(x402AgentSchema);
