import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";

import { Marketplace } from "./marketplace.client";

vi.mock("@/components/agents/agent-icon", () => ({ AgentIcon: () => null }));

function agent(overrides: Partial<CatalogBrowseAgent>): CatalogBrowseAgent {
  return {
    id: "a",
    kind: "cardano",
    name: "Agent",
    description: null,
    summary: null,
    image: null,
    icon: null,
    categories: [],
    metrics: {
      executions: { count: 0, averageTime: null },
      ratings: { total: 0, average: null },
    },
    author: { name: null, image: null, organization: null, other: null },
    externalUrl: null,
    ...overrides,
  };
}

const agents = [
  agent({
    id: "research",
    name: "Deep Research",
    summary: "Sourced reports.",
    author: { name: "Ann", image: null, organization: "Masumi", other: null },
  }),
  agent({ id: "seo", name: "SEO Audit", summary: "Fixes for search." }),
  agent({
    id: "knight",
    name: "Deepfake Detector - Knight",
    author: {
      name: "Default Author",
      image: "https://c-ipfs-gw.nmkr.io/ipfs/nuauth-logo",
      organization: null,
      other: null,
    },
  }),
  agent({
    id: "pay",
    kind: "x402",
    name: "Paywall",
    externalUrl: "https://example.com/pay",
  }),
  agent({ id: "nowhere", kind: "x402", name: "No link" }),
];

function renderMarketplace(searchParams = "") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Marketplace agents={agents} />
    </NextIntlClientProvider>,
    { wrapper: withNuqsTestingAdapter({ searchParams, hasMemory: true }) },
  );
}

describe("Marketplace", () => {
  it("shows each agent with its vendor, links our agents to their profile and x402 ones out", () => {
    renderMarketplace();

    const research = screen.getByRole("link", { name: /Deep Research/ });
    expect(research).toHaveAttribute("href", "/agents/research");
    expect(research).toHaveTextContent("by Masumi");
    const pay = screen.getByRole("link", { name: /Paywall/ });
    expect(pay).toHaveAttribute("href", "https://example.com/pay");
    expect(pay).toHaveAttribute("target", "_blank");
    // An x402 agent with no page of its own has nowhere to go.
    expect(screen.queryByText("No link")).not.toBeInTheDocument();
  });

  it("shows the author logo before the author's name, as the old gallery did", () => {
    renderMarketplace();

    const knight = screen.getByRole("link", { name: /Knight/ });
    const card = knight.closest("li");
    expect(card).not.toHaveTextContent("Default Author");
    expect(
      screen.getByAltText(
        "Logo of the company behind Deepfake Detector - Knight",
      ),
    ).toHaveAttribute("src", "https://c-ipfs-gw.nmkr.io/ipfs/nuauth-logo");
    // No logo: the organization, then the person.
    expect(
      screen.getByRole("link", { name: /Deep Research/ }).closest("li"),
    ).toHaveTextContent("by Masumi");
  });

  it("filters by the search and announces the count", async () => {
    const user = userEvent.setup();
    renderMarketplace();

    await user.type(
      screen.getByRole("searchbox", { name: "Search the Agent Marketplace" }),
      "seo",
    );

    expect(screen.getByRole("link", { name: /SEO Audit/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Deep Research/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 agent matches");
  });

  it("says so when nothing matches", () => {
    renderMarketplace("?query=zzz");

    expect(
      screen.getByText("No agents match your search."),
    ).toBeInTheDocument();
  });
});
