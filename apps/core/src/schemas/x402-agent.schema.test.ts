import { describe, expect, it } from "vitest";

import { x402AgentSchema } from "./x402-agent.schema";

function bazaarFixedAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmaeygqwa000e8i0s9s7wif8i",
    specification: "bazaar",
    name: "Bazaar Research Agent",
    description: null,
    image: null,
    x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
    openApiSpecUrl: null,
    pricingType: "fixed",
    isPayable: true,
    paymentSources: [
      {
        caip2Network: "eip155:84532",
        asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        decimals: 6,
        payTo: "0x1111111111111111111111111111111111111111",
        amount: "250000",
        credits: 0.5,
      },
    ],
    ...overrides,
  };
}

describe("x402AgentSchema discovery URLs", () => {
  it("accepts an absolute HTTPS discovery URL", () => {
    expect(x402AgentSchema.safeParse(bazaarFixedAgent()).success).toBe(true);
  });

  // The route already drops such rows (`hasValidX402DiscoveryUrl`); the
  // schema must refuse them too so a future producer bypassing the route
  // gate cannot publish an arbitrary string as a discovery URL.
  it.each([
    ["a relative path", "/x402"],
    ["a non-HTTP scheme", "ftp://agent.example.com/x402"],
    ["an arbitrary string", "not a url"],
    ["a javascript URL", "javascript:alert(1)"],
  ])("refuses %s as a discovery URL", (_label, url) => {
    expect(
      x402AgentSchema.safeParse(bazaarFixedAgent({ x402ResourcesUrl: url }))
        .success,
    ).toBe(false);
    expect(
      x402AgentSchema.safeParse(
        bazaarFixedAgent({
          specification: "openapi",
          x402ResourcesUrl: null,
          openApiSpecUrl: url,
        }),
      ).success,
    ).toBe(false);
  });

  it("still allows the non-applicable URL slot to be null", () => {
    expect(
      x402AgentSchema.safeParse(
        bazaarFixedAgent({
          specification: "openapi",
          x402ResourcesUrl: null,
          openApiSpecUrl: "https://agent.example.com/openapi.json",
        }),
      ).success,
    ).toBe(true);
  });
});
