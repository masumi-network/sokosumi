import { describe, expect, it } from "vitest";

import { getHistoryEmptyState } from "./history-empty-state";
import type { HistoryFilters } from "./history-filters";

// Echoes the key and values, so tests see which copy was picked.
const t = ((key: string, values?: Record<string, string>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as Parameters<
  typeof getHistoryEmptyState
>[0];

const none: HistoryFilters = {
  q: null,
  scope: "owned",
  type: null,
  projectId: null,
  taskId: null,
};

describe("getHistoryEmptyState", () => {
  it("offers a new task when nothing narrows the ledger", () => {
    expect(getHistoryEmptyState(t, none, null)).toEqual({
      labels: { title: "Empty.title", description: "Empty.description" },
      clearFilters: null,
    });
  });

  it("names the search, because on phones the search box is hidden", () => {
    const state = getHistoryEmptyState(t, { ...none, q: "invoice" }, null);
    expect(state.labels).toEqual({
      title: 'EmptyFiltered.searchTitle {"query":"invoice"}',
      description: "EmptyFiltered.searchDescription",
    });
    expect(state.clearFilters).toEqual({
      href: "/history",
      label: "EmptyFiltered.clear",
    });
  });

  it("speaks of filters only when no search is set", () => {
    const state = getHistoryEmptyState(t, { ...none, type: "image" }, null);
    expect(state.labels).toEqual({
      title: "EmptyFiltered.title",
      description: "EmptyFiltered.description",
    });
  });

  it("keeps the scope when clearing", () => {
    const state = getHistoryEmptyState(
      t,
      { ...none, q: "invoice", scope: "workspace", projectId: "p" },
      "org-1",
    );
    expect(state.clearFilters?.href).toBe("/history?scope=workspace");
  });
});
