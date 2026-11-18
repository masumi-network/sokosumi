// @vitest-environment happy-dom

import type { CmoCompetitors } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { competitors } from "../../app/design-system/app/competitors-fixture";
import { cmoOverview } from "../../test-fixtures/cmo";
import {
  type CompetitorActions,
  CompetitorsPage,
  watchedMap,
} from "./competitors-page";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const text = () => container.textContent ?? "";
const press = (label: string, index = 0) =>
  act(async () => {
    const found = [...container.querySelectorAll("button")].filter(
      (element) => element.textContent === label,
    )[index];
    if (!found) throw new Error(`No button "${label}"`);
    found.click();
  });

function actions(patch: Partial<CompetitorActions> = {}): CompetitorActions {
  const same = async () => ({ competitors, error: null });
  return {
    loadCompetitors: async () => competitors,
    addCompetitor: same,
    updateCompetitor: same,
    removeCompetitor: same,
    addMoveToStrategy: same,
    ...patch,
  };
}

function render(given: CompetitorActions, compose = vi.fn()) {
  return act(async () =>
    root.render(
      <CompetitorsPage
        overview={cmoOverview()}
        actions={given}
        compose={compose}
      />,
    ),
  );
}

const quiet: CmoCompetitors = {
  ...competitors,
  competitors: [],
  feed: null,
  signals: [],
  scoreboard: [competitors.scoreboard[3] ?? competitors.scoreboard[0]].flatMap(
    (row) => (row ? [{ ...row, competitorId: null, name: "acme.io" }] : []),
  ),
  topPosts: [],
  check: {
    ...competitors.check,
    lastCheckedAt: null,
    nextCheckAt: null,
    sources: {
      ...competitors.check.sources,
      social: {
        status: "not_connected",
        needs: "Connect your Instagram business account.",
      },
    },
  },
};

describe("CompetitorsPage", () => {
  it("shows a skeleton until the page loads, then the week's moves", async () => {
    let finish: (value: CmoCompetitors) => void = () => {};
    await render(
      actions({
        loadCompetitors: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    );
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(text()).toContain("Loading your competitors");

    await act(async () => finish(competitors));
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
    expect(text()).toContain(
      "Northwind raised its Pro plan from $12 to $15 a seat.",
    );
    expect(text()).toContain("What this means for you");
    expect(text()).toContain("Suggested move");
    expect(text()).toContain("Big move");
    expect(text()).toContain("Still open");
  });

  it("gives each fact its source: title, publisher, date, quote and link", async () => {
    await render(actions());
    const tip = container.querySelector(".comp-fact .source-pop");
    expect(tip?.textContent).toContain("Northwind pricing");
    expect(tip?.textContent).toContain("16 Nov");
    expect(tip?.textContent).toContain(
      "Pro $15 per seat a month, billed yearly",
    );
    expect(tip?.querySelector("a")?.getAttribute("href")).toBe(
      "https://northwind.example/pricing",
    );
    const chip = container.querySelector(".comp-fact .source-chip");
    // The chip opens the note: a press, Enter and Escape are the browser's.
    expect(chip?.getAttribute("popovertarget")).toBe(tip?.id);
    expect(tip?.getAttribute("popover")).toBe("auto");
  });

  it("marks a fact its sources back only in part", async () => {
    await render(actions());
    const weak = [...container.querySelectorAll(".comp-fact")].find((fact) =>
      fact.textContent?.includes("Globex launched a free plan"),
    );
    expect(weak?.textContent).toContain("Partly backed");
    expect(text()).toContain(
      "Partly backed: the source supports only part of the sentence.",
    );
  });

  it("says so when a fact's source is no longer stored", async () => {
    await render(
      actions({
        loadCompetitors: async () => ({ ...competitors, signals: [] }),
      }),
    );
    const facts = [...container.querySelectorAll(".comp-fact")];
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.querySelector(".source-chip")).toBeNull();
      expect(fact.textContent).toContain("Its source is older than I keep.");
    }
  });

  it("keeps the business and the watched competitors on the map", () => {
    const map = {
      x: { low: "Cheap", high: "Premium" },
      y: { low: "Self-serve", high: "Done for you" },
      players: [
        { name: "Acme", x: 70, y: 70, you: true },
        { name: "Verve Coffee Roasters", x: 20, y: 30 },
        { name: "Trade Coffee", x: 80, y: 10 },
      ],
    };
    expect(
      watchedMap(map, ["Verve Coffee Roasters"]).players.map(
        (player) => player.name,
      ),
    ).toEqual(["Acme", "Verve Coffee Roasters"]);
    expect(watchedMap(map, []).players.map((player) => player.name)).toEqual([
      "Acme",
    ]);
  });

  it("sends a move to the strategy once and shows it as added", async () => {
    const added: CmoCompetitors = {
      ...competitors,
      feed: competitors.feed && {
        ...competitors.feed,
        items: competitors.feed.items.map((item) => ({
          ...item,
          addedToStrategyAt: "2026-11-16T10:00:00.000Z",
        })),
      },
    };
    const addMoveToStrategy = vi.fn(async () => ({
      competitors: added,
      error: null,
    }));
    await render(actions({ addMoveToStrategy }));
    // The second move is in the strategy already.
    expect(
      [...container.querySelectorAll("button")].filter(
        (button) => button.textContent === "Add to strategy",
      ),
    ).toHaveLength(1);
    await press("Add to strategy");
    expect(addMoveToStrategy).toHaveBeenCalledWith(
      "cccccccc-cccc-4ccc-8ccc-000000000001",
    );
    expect(text()).not.toContain("Add to strategy");
  });

  it("shows why a change did not go through", async () => {
    await render(
      actions({
        addMoveToStrategy: async () => ({
          competitors: null,
          error: "Cuso is finishing a change",
        }),
      }),
    );
    await press("Add to strategy");
    // Beside the move it was pressed on, not at the top of the page.
    expect(
      container.querySelector(".comp-move [role='alert']")?.textContent,
    ).toBe("Cuso is finishing a change");
    expect(container.querySelectorAll("[role='alert']")).toHaveLength(1);
  });

  it("leaves a cell without data empty and says so", async () => {
    await render(actions());
    const rows = [...container.querySelectorAll(".comp-table tbody tr")];
    expect(rows.map((row) => row.querySelector("th")?.textContent)).toEqual([
      "You (acme.io)",
      "Northwind",
      "Globex",
      "Initech",
    ]);
    const initech = rows[3];
    expect(initech?.querySelectorAll("[aria-label='No data']")).toHaveLength(4);
    expect(rows[1]?.textContent).toContain("41.2K");
    expect(rows[1]?.textContent).toContain("-120");
    expect(rows[0]?.textContent).toContain("+35");
    expect(rows[1]?.querySelector(".source-pop")?.textContent).toContain(
      "read 16 Nov",
    );
  });

  it("asks for ideas from a competitor's top posts in chat", async () => {
    const compose = vi.fn();
    await render(actions(), compose);
    await press("Ask Cuso for ideas");
    expect(compose).toHaveBeenCalledWith(
      expect.stringContaining("Northwind's strongest Instagram posts"),
    );
    expect(compose.mock.calls[0]?.[0]).toContain("never copies");
  });

  it("adds, edits and removes a competitor", async () => {
    const addCompetitor = vi.fn(async () => ({ competitors, error: null }));
    const updateCompetitor = vi.fn(async () => ({ competitors, error: null }));
    const removeCompetitor = vi.fn(async () => ({ competitors, error: null }));
    await render(
      actions({ addCompetitor, updateCompetitor, removeCompetitor }),
    );
    expect(text()).toContain("3 of 5");

    await press("Add a competitor");
    const name = container.querySelector<HTMLInputElement>(
      ".comp-form input[required]",
    );
    if (!name) throw new Error("No name field");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(name, "Zcal");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Add competitor");
    expect(addCompetitor).toHaveBeenCalledWith({
      name: "Zcal",
      websiteUrl: null,
      pricingUrl: null,
      instagramHandle: null,
      facebookHandle: null,
    });

    await press("Edit");
    await press("Save");
    expect(updateCompetitor).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
      expect.objectContaining({
        name: "Northwind",
        websiteUrl: "https://northwind.example/",
      }),
    );

    await press("Remove", 1);
    expect(removeCompetitor).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
    );
  });

  it("explains an empty page: nobody watched, no check, no Instagram", async () => {
    await render(actions({ loadCompetitors: async () => quiet }));
    expect(text()).toContain(
      "Add a competitor below and I check it within the hour.",
    );
    expect(text()).toContain("Nobody yet.");
    expect(text()).toContain("Connect your Instagram business account.");
    expect(text()).toContain("0 of 5");
    // No table of nothing but empty cells.
    expect(container.querySelector(".comp-table")).toBeNull();
    expect(text()).not.toContain("What worked for them");
    expect(text()).not.toContain("What the checks found");
  });

  it("says when nothing solid moved, and what is still open", async () => {
    await render(
      actions({
        loadCompetitors: async () => ({
          ...competitors,
          feed: competitors.feed && {
            ...competitors.feed,
            items: [],
            openQuestions: ["Whether Globex's free plan includes routing."],
          },
        }),
      }),
    );
    expect(text()).toContain("Nothing solid moved this week.");
    expect(text()).toContain("Whether Globex's free plan includes routing.");
  });

  it("offers to load again when the page does not load", async () => {
    const loadCompetitors = vi
      .fn<CompetitorActions["loadCompetitors"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(competitors);
    await render(actions({ loadCompetitors }));
    expect(text()).toContain("Your competitors did not load");
    await press("Try again");
    expect(text()).toContain("This week");
  });
});
