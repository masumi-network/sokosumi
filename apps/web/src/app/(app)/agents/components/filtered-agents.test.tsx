import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import useGalleryFilter from "@/hooks/use-gallery-filter";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { createMockCatalogBrowseAgent } from "@/lib/helpers/__tests__/fixtures/catalog-browse-agent";
import type { Category } from "@/lib/types/category";

import FilteredAgents from "./filtered-agents";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: { count?: number; query?: string }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  useFormatter: () => ({ number: (value: number) => `n${value}` }),
}));

vi.mock("@/app/agents/components/filter-section", () => ({
  default: () => null,
}));

vi.mock("@/components/agents/agents", () => ({
  Agents: ({ agents }: { agents: { name: string }[] }) => (
    <ul>
      {agents.map((agent) => (
        <li key={agent.name}>{agent.name}</li>
      ))}
    </ul>
  ),
  AgentsNotAvailable: () => null,
  AgentsNotFound: () => <p>notFound</p>,
}));

const agents = [
  createMockCatalogBrowseAgent({
    id: "a1",
    name: "Research Bot",
    categories: [],
  }),
  createMockCatalogBrowseAgent({ id: "a2", name: "News Bot", categories: [] }),
];
// Agents without a category group under the default one.
const categories: Category[] = [
  { name: "Other", slug: SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, priority: 0 },
];

// Stands in for the hero's Show control, which lives in the coworker tier.
function ShowAgents() {
  const { setScope } = useGalleryFilter();
  return (
    <button type="button" onClick={() => void setScope("agents")}>
      showAgents
    </button>
  );
}

function renderAt(searchParams: string) {
  return render(
    <>
      <ShowAgents />
      <FilteredAgents
        agents={agents}
        ratingStatsMap={{}}
        categories={categories}
        title="All agents"
        subtitle="Every agent"
      />
    </>,
    { wrapper: withNuqsTestingAdapter({ searchParams, hasMemory: true }) },
  );
}

describe("FilteredAgents", () => {
  it("keeps an old agentQuery catalog filter beside a query", async () => {
    renderAt("?query=news&agentQuery=research");

    expect(await screen.findByText("Research Bot")).toBeInTheDocument();
    expect(screen.queryByText("News Bot")).not.toBeInTheDocument();
  });

  it("shows a formatted count and announces it politely", async () => {
    renderAt("?query=news");

    expect(
      await screen.findByRole("heading", { name: "All agents · n1" }),
    ).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("agentsFound:1");
  });

  it("keeps its status region mounted, silent, when Coworkers is shown", async () => {
    renderAt("?query=news&show=coworkers");

    expect(await screen.findByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.queryByRole("heading", { name: /All agents/ }),
    ).not.toBeInTheDocument();
  });

  it("announces in the same status node when Show moves from Coworkers to Agents", async () => {
    const user = userEvent.setup();
    renderAt("?query=news&show=coworkers");
    const status = await screen.findByRole("status");
    expect(status).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "showAgents" }));

    expect(
      await screen.findByRole("heading", { name: "All agents · n1" }),
    ).toBeInTheDocument();
    // A region inserted already filled is often not read; the old node must
    // receive the new text.
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("agentsFound:1");
  });
});
