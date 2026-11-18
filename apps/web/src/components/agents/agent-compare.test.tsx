import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useRef, useState } from "react";
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
  metrics: {
    executions: { count: 42, averageTime: 90 },
    ratings: { total: 8, average: 4.5 },
  },
});
const beta = createMockCatalogBrowseAgent({
  id: "beta",
  name: "Beta Writer",
  author: { name: "Beta Labs", image: null, organization: null, other: null },
});
const gamma = createMockCatalogBrowseAgent({ id: "gamma", name: "Gamma" });
const delta = createMockCatalogBrowseAgent({ id: "delta", name: "Delta" });
const agents = [alpha, beta, gamma, delta];

function Catalog() {
  const catalogRef = useRef<HTMLDivElement>(null);
  // Stands in for the gallery filter hiding cards.
  const [onlyDelta, setOnlyDelta] = useState(false);
  const visible = onlyDelta ? [delta] : agents;
  return (
    <div ref={catalogRef} tabIndex={-1} data-testid="catalog">
      <button type="button" onClick={() => setOnlyDelta(true)}>
        Filter to Delta
      </button>
      {visible.map((agent) => (
        <AgentCompareToggle key={agent.id} agent={agent} />
      ))}
      <AgentCompareBar agents={agents} returnFocusTo={catalogRef} />
    </div>
  );
}

function view() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AgentCompareProvider>
        <Catalog />
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
    expect(within(dialog).queryByText(/credit/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText("4.5 (8)")).toBeInTheDocument();
    expect(within(dialog).getByText("No ratings yet")).toBeInTheDocument();
    expect(within(dialog).getByText("42")).toBeInTheDocument();
    expect(within(dialog).getByText("Writes blog posts.")).toBeInTheDocument();
    expect(within(dialog).getByText("Beta Labs")).toBeInTheDocument();
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
    expect(screen.getByTestId("catalog")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Compare Delta" })).toBeEnabled();
  });

  it("removes one pick from the bar, even when a filter hides its card", async () => {
    const user = userEvent.setup();
    view();
    for (const name of ["Alpha Writer", "Beta Writer", "Gamma"]) {
      await user.click(screen.getByRole("button", { name: `Compare ${name}` }));
    }

    await user.click(screen.getByRole("button", { name: "Filter to Delta" }));
    expect(
      screen.getByRole("button", { name: "Compare Delta" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Remove Alpha Writer" }),
    );
    expect(
      screen.queryByRole("button", { name: "Remove Alpha Writer" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Compare Delta" })).toBeEnabled();
  });
});
