import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  AgentCompareBar,
  AgentCompareProvider,
  AgentCompareToggle,
} from "@/components/agents/agent-compare";
import { createMockCatalogBrowseAgent } from "@/lib/helpers/__tests__/fixtures/catalog-browse-agent";
import en from "@/messages/en.json";

const alpha = createMockCatalogBrowseAgent({
  id: "alpha",
  name: "Alpha Writer",
  summary: "Writes blog posts.",
  credits: 120,
  metrics: {
    executions: { count: 42, averageTime: 90 },
    ratings: { total: 8, average: 4.5 },
  },
});
const beta = createMockCatalogBrowseAgent({
  id: "beta",
  name: "Beta Writer",
  credits: 30,
  author: { name: "Beta Labs", image: null, organization: null, other: null },
});
const gamma = createMockCatalogBrowseAgent({ id: "gamma", name: "Gamma" });
const delta = createMockCatalogBrowseAgent({ id: "delta", name: "Delta" });
const agents = [alpha, beta, gamma, delta];

function view() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AgentCompareProvider>
        {agents.map((agent) => (
          <AgentCompareToggle key={agent.id} agent={agent} />
        ))}
        <AgentCompareBar agents={agents} />
      </AgentCompareProvider>
    </NextIntlClientProvider>,
  );
}

describe("compare agents", () => {
  it("compares two picked agents side by side", async () => {
    const user = userEvent.setup();
    view();

    expect(
      screen.queryByRole("button", { name: /^Compare \d/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Compare Alpha Writer" }),
    );
    expect(screen.getByRole("button", { name: "Compare 1" })).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Compare Beta Writer" }),
    );
    await user.click(screen.getByRole("button", { name: "Compare 2" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("120 credits")).toBeInTheDocument();
    expect(within(dialog).getByText("30 credits")).toBeInTheDocument();
    expect(within(dialog).getByText("4.5 (8)")).toBeInTheDocument();
    expect(within(dialog).getByText("No ratings yet")).toBeInTheDocument();
    expect(within(dialog).getByText("42")).toBeInTheDocument();
    expect(within(dialog).getByText("Writes blog posts.")).toBeInTheDocument();
    expect(within(dialog).getByText("Beta Labs")).toBeInTheDocument();
    expect(within(dialog).getByText("Lowest price")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Alpha Writer" }),
    ).toHaveAttribute("href", "/agents/alpha");
  });

  it("caps the comparison at three agents and can be cleared", async () => {
    const user = userEvent.setup();
    view();

    for (const name of ["Alpha Writer", "Beta Writer", "Gamma"]) {
      await user.click(screen.getByRole("button", { name: `Compare ${name}` }));
    }

    expect(
      screen.getByRole("button", { name: "Compare Delta" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Compare Alpha Writer" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.queryByRole("button", { name: /^Compare \d/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare Delta" })).toBeEnabled();
  });
});
