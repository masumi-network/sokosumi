import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  X402Agent,
  X402DynamicAgentPaymentSource,
  X402FixedAgentPaymentSource,
} from "@/lib/clients/generated/core";

import {
  filterX402AgentsByQuery,
  resolveX402AgentImage,
  X402AgentCard,
} from "../x402-agent-card";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en", options).format(value),
  }),
  useTranslations:
    () =>
    (key: string, values?: Record<string, string | number>): string => {
      if (key === "pricing") {
        return `From ${values?.price} credits`;
      }
      if (key === "sources") {
        return `${values?.count} payment routes`;
      }
      return key;
    },
}));

const FIXED_SOURCE: X402FixedAgentPaymentSource = {
  caip2Network: "eip155:8453",
  asset: "0x1111111111111111111111111111111111111111",
  decimals: 6,
  payTo: "0x2222222222222222222222222222222222222222",
  amount: "250000",
  credits: 0.5,
};

const DYNAMIC_SOURCE: X402DynamicAgentPaymentSource = {
  pricingType: "dynamic",
  caip2Network: "eip155:84532",
  payTo: "0x2222222222222222222222222222222222222222",
};

const AGENT: Extract<X402Agent, { pricingType: "fixed" }> = {
  id: "agent_x402_preview",
  specification: "bazaar",
  name: "Signal Research",
  description: "Researches markets and returns cited findings.",
  image: null,
  x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
  openApiSpecUrl: null,
  pricingType: "fixed",
  isPayable: true,
  paymentSources: [
    FIXED_SOURCE,
    {
      caip2Network: "eip155:1",
      asset: "0x3333333333333333333333333333333333333333",
      decimals: 6,
      payTo: "0x2222222222222222222222222222222222222222",
      amount: "500000",
      credits: 1,
    },
  ],
};

const DYNAMIC_AGENT: Extract<X402Agent, { pricingType: "dynamic" }> = {
  id: "agent_x402_dynamic",
  specification: "openapi",
  name: "Dynamic Research",
  description: "Prices each research request dynamically.",
  image: null,
  x402ResourcesUrl: null,
  openApiSpecUrl: "https://dynamic.example.com/openapi.json",
  pricingType: "dynamic",
  isPayable: true,
  paymentSources: [DYNAMIC_SOURCE],
};

const MIXED_AGENT: Extract<X402Agent, { pricingType: "mixed" }> = {
  id: "agent_x402_mixed",
  specification: "openapi",
  name: "Mixed Research",
  description: "Supports fixed and dynamic payment routes.",
  image: null,
  x402ResourcesUrl: null,
  openApiSpecUrl: "https://mixed.example.com/openapi.json",
  pricingType: "mixed",
  isPayable: true,
  paymentSources: [FIXED_SOURCE, DYNAMIC_SOURCE],
};

describe("X402AgentCard", () => {
  it("marks the card as x402 preview without exposing a hire action", () => {
    render(<X402AgentCard agent={AGENT} />);

    expect(screen.getByText("Signal Research")).toBeInTheDocument();
    expect(screen.getByText("x402")).toBeInTheDocument();
    expect(screen.getByText("bazaarSpec")).toBeInTheDocument();
    expect(screen.getByText("preview")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("2 payment routes")).toBeInTheDocument();
    expect(screen.getByText("From 0.5 credits")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hire/i })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("resolves IPFS images and labels OpenAPI entries separately", () => {
    render(<X402AgentCard agent={DYNAMIC_AGENT} />);

    expect(screen.getByText("openApiSpec")).toBeInTheDocument();
    expect(resolveX402AgentImage("ipfs://QmExampleAgentImage")).toBe(
      "https://c-ipfs-gw.nmkr.io/ipfs/QmExampleAgentImage",
    );
  });

  it("uses fallback copy and icon when optional metadata is absent", () => {
    render(
      <X402AgentCard agent={{ ...AGENT, description: null, image: null }} />,
    );

    expect(screen.getByText("fallbackDescription")).toBeInTheDocument();
    expect(screen.getByText("coworkerAccess")).toBeInTheDocument();
  });

  it("does not round a positive sub-cent price down to zero", () => {
    render(
      <X402AgentCard
        agent={{
          ...AGENT,
          paymentSources: [{ ...AGENT.paymentSources[0], credits: 1e-10 }],
        }}
      />,
    );

    expect(screen.getByText("From 0.0000000001 credits")).toBeInTheDocument();
    expect(screen.queryByText("From 0 credits")).toBeNull();
  });

  it("renders dynamic pricing as coworker-payable", () => {
    render(<X402AgentCard agent={DYNAMIC_AGENT} />);

    expect(screen.getByText("Dynamic Research")).toBeInTheDocument();
    expect(screen.getByText("Base Sepolia")).toBeInTheDocument();
    expect(screen.getByText("dynamicPricing")).toBeInTheDocument();
    expect(screen.getByText("coworkerAccess")).toBeInTheDocument();
    expect(screen.queryByText(/From .* credits/)).toBeNull();
  });

  it("labels mixed source pricing without implying one fixed floor", () => {
    render(<X402AgentCard agent={MIXED_AGENT} />);

    expect(screen.getByText("mixedPricing")).toBeInTheDocument();
    expect(screen.getByText("coworkerAccess")).toBeInTheDocument();
    expect(screen.queryByText(/From .* credits/)).toBeNull();
  });
});

describe("filterX402AgentsByQuery", () => {
  it("matches card metadata and visible tags", () => {
    const agents = [AGENT, DYNAMIC_AGENT];

    expect(filterX402AgentsByQuery(agents, "signal")).toEqual([AGENT]);
    expect(filterX402AgentsByQuery(agents, "cited findings")).toEqual([AGENT]);
    expect(filterX402AgentsByQuery(agents, "markets")).toEqual([AGENT]);
    expect(filterX402AgentsByQuery(agents, "x402")).toEqual(agents);
    expect(filterX402AgentsByQuery(agents, "dynamic")).toEqual([DYNAMIC_AGENT]);
    expect(filterX402AgentsByQuery(agents, "bazaar")).toEqual([AGENT]);
    expect(filterX402AgentsByQuery(agents, "OpenAPI")).toEqual([DYNAMIC_AGENT]);
    expect(filterX402AgentsByQuery(agents, "missing")).toEqual([]);
  });
});
