import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";

import FilteredAgents from "../components/filtered-agents";

const { setAgentStar, toastError, filter } = vi.hoisted(() => ({
  setAgentStar: vi.fn(),
  toastError: vi.fn(),
  filter: { query: "", categories: [] as string[], kind: "all" },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/actions/agent/set-agent-star", () => ({ setAgentStar }));
vi.mock("@/hooks/use-gallery-filter", () => ({ default: () => filter }));
vi.mock("@/app/agents/components/filter-section", () => ({
  default: () => null,
}));
// One row per carousel: its title and a star toggle per Agent.
vi.mock("@/components/agents/agents", () => ({
  AgentsNotAvailable: () => null,
  AgentsNotFound: () => <p>none</p>,
  Agents: ({
    title,
    agents,
    starredIds,
    pendingStarIds,
    onToggleStar,
  }: {
    title: string;
    agents: CatalogBrowseAgent[];
    starredIds: ReadonlySet<string>;
    pendingStarIds: ReadonlySet<string>;
    onToggleStar: (id: string) => void;
  }) => (
    <section aria-label={title}>
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          aria-pressed={starredIds.has(agent.id)}
          aria-busy={pendingStarIds.has(agent.id)}
          onClick={() => onToggleStar(agent.id)}
        >
          {agent.name}
        </button>
      ))}
    </section>
  ),
}));

function agent(id: string, name: string): CatalogBrowseAgent {
  return {
    id,
    kind: "cardano",
    name,
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
  };
}

const AGENTS = [agent("a1", "Writer"), agent("a2", "Researcher")];

function renderAgents(starredAgentIds: string[]) {
  render(
    <FilteredAgents
      agents={AGENTS}
      ratingStatsMap={{}}
      categories={[
        {
          slug: SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
          name: "Others",
          priority: 1,
        },
      ]}
      starredAgentIds={starredAgentIds}
    />,
  );
}

const starredRow = () =>
  screen.queryByRole("region", { name: "starredCategory" });

beforeEach(() => {
  vi.clearAllMocks();
  filter.query = "";
  setAgentStar.mockResolvedValue({ ok: true, value: undefined });
});

describe("FilteredAgents Starred row", () => {
  it("shows no Starred row until something is starred", () => {
    renderAgents([]);
    expect(starredRow()).toBeNull();
  });

  it("puts starred Agents in their own row first", () => {
    renderAgents(["a2"]);
    const regions = screen.getAllByRole("region");
    expect(regions[0]).toBe(starredRow());
    expect(starredRow()?.textContent).toBe("Researcher");
  });

  it("applies the search to the Starred row too", () => {
    filter.query = "writer";
    renderAgents(["a2"]);
    expect(starredRow()).toBeNull();
  });

  it("stars at once and saves it", async () => {
    renderAgents([]);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Writer" })[0] as HTMLElement,
      );
    });
    expect(setAgentStar).toHaveBeenCalledWith("a1", true);
    expect(starredRow()?.textContent).toBe("Writer");
  });

  it("puts the star back and says so when saving fails", async () => {
    setAgentStar.mockResolvedValue({ ok: false, error: { code: "FAILED" } });
    renderAgents(["a1"]);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Writer" })[0] as HTMLElement,
      );
    });
    expect(setAgentStar).toHaveBeenCalledWith("a1", false);
    expect(starredRow()?.textContent).toBe("Writer");
    expect(toastError).toHaveBeenCalledWith("starFailed");
  });

  it("ignores repeat toggles while a save runs, on every copy of the card", async () => {
    let finish: (value: unknown) => void = () => {};
    setAgentStar.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderAgents([]);
    const writer = () => screen.getAllByRole("button", { name: "Writer" });

    act(() => {
      fireEvent.click(writer()[0] as HTMLElement);
    });
    // Starred row and catalog row both show the same running save.
    expect(writer().map((b) => b.getAttribute("aria-busy"))).toEqual([
      "true",
      "true",
    ]);
    act(() => {
      fireEvent.click(writer()[1] as HTMLElement);
    });
    expect(setAgentStar).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ ok: false, error: { code: "FAILED" } });
    });
    expect(starredRow()).toBeNull();
    expect(writer()[0]?.getAttribute("aria-busy")).toBe("false");
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("goes back to the saved state when the request itself fails", async () => {
    setAgentStar.mockRejectedValue(new Error("network"));
    renderAgents([]);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Writer" })[0] as HTMLElement,
      );
    });
    expect(starredRow()).toBeNull();
    expect(toastError).toHaveBeenCalledWith("starFailed");
  });
});
