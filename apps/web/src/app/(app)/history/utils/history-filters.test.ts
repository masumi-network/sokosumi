import { describe, expect, it } from "vitest";
import {
  applyHistoryProjectAllowlist,
  buildHistoryFiltersSearchParams,
  getDefaultHistoryScope,
  getHistoryFiltersFromSearchParams,
  getHistoryFiltersResetKey,
  HISTORY_SEARCH_MAX_LENGTH,
  HISTORY_TYPE_VALUES,
  parseHistoryFilters,
  resolveHistoryApiTypes,
  sanitizeHistoryProjectIdInput,
  sanitizeHistoryScopeInput,
  sanitizeHistorySearchInput,
  sanitizeHistoryTypeInput,
} from "@/app/history/utils/history-filters";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const projectOptions = [{ id: PROJECT_ID, name: "Research" }] as const;

describe("history-filters", () => {
  it("defaults to owned scope in both personal and organization context", () => {
    expect(getDefaultHistoryScope("org-1")).toBe("owned");
    expect(getDefaultHistoryScope(null)).toBe("owned");
    expect(parseHistoryFilters({}, "org-1")).toEqual({
      q: null,
      scope: "owned",
      type: null,
      projectId: null,
    });
  });

  it("covers every consumption source the ledger can return", () => {
    expect([...HISTORY_TYPE_VALUES]).toEqual([
      "job",
      "image",
      "task",
      "coworker",
      "sokoBot",
      "unattributed",
    ]);
    expect(resolveHistoryApiTypes(null)).toEqual([...HISTORY_TYPE_VALUES]);
    expect(resolveHistoryApiTypes("unattributed")).toEqual(["unattributed"]);
  });

  it("rejects a source value the ledger does not have", () => {
    expect(sanitizeHistoryTypeInput("job")).toBe("job");
    expect(sanitizeHistoryTypeInput("sokoBot")).toBe("sokoBot");
    // The old feed's kinds that are not consumption sources.
    expect(sanitizeHistoryTypeInput("conversation")).toBeNull();
    expect(sanitizeHistoryTypeInput("archived")).toBeNull();
    expect(sanitizeHistoryTypeInput(42)).toBeNull();
  });

  it("falls back to the default scope for an unknown or unavailable scope", () => {
    expect(sanitizeHistoryScopeInput("workspace", "org-1")).toBe("workspace");
    expect(sanitizeHistoryScopeInput("nonsense", "org-1")).toBe("owned");
    // Without an organization there is no workspace to widen to.
    expect(sanitizeHistoryScopeInput("workspace", null)).toBe("owned");
  });

  it("trims and caps the search input", () => {
    expect(sanitizeHistorySearchInput("  onboarding  ")).toBe("onboarding");
    expect(sanitizeHistorySearchInput("   ")).toBeNull();
    expect(sanitizeHistorySearchInput(null)).toBeNull();
    expect(
      sanitizeHistorySearchInput("x".repeat(HISTORY_SEARCH_MAX_LENGTH + 10)),
    ).toHaveLength(HISTORY_SEARCH_MAX_LENGTH);
  });

  it("accepts only a UUID as a project filter", () => {
    expect(sanitizeHistoryProjectIdInput(PROJECT_ID)).toBe(PROJECT_ID);
    expect(sanitizeHistoryProjectIdInput("not-a-uuid")).toBeNull();
  });

  it("drops a project the caller cannot see", () => {
    expect(
      applyHistoryProjectAllowlist(
        { q: null, scope: "owned", type: null, projectId: PROJECT_ID },
        projectOptions,
      ).projectId,
    ).toBe(PROJECT_ID);
    expect(
      applyHistoryProjectAllowlist(
        {
          q: null,
          scope: "owned",
          type: null,
          projectId: "44444444-4444-4444-8444-444444444444",
        },
        projectOptions,
      ).projectId,
    ).toBeNull();
  });

  it("reads filters back out of search params", () => {
    const filters = getHistoryFiltersFromSearchParams(
      new URLSearchParams({
        q: "poster",
        scope: "workspace",
        type: "image",
        projectId: PROJECT_ID,
      }),
      "org-1",
      projectOptions,
    );

    expect(filters).toEqual({
      q: "poster",
      scope: "workspace",
      type: "image",
      projectId: PROJECT_ID,
    });
  });

  it("omits the default scope and empty filters from the query string", () => {
    const params = buildHistoryFiltersSearchParams(
      new URLSearchParams(),
      { q: null, scope: "owned", type: null, projectId: null },
      "org-1",
    );

    expect(params.toString()).toBe("");
  });

  it("writes non-default filters to the query string", () => {
    const params = buildHistoryFiltersSearchParams(
      new URLSearchParams(),
      {
        q: "poster",
        scope: "workspace",
        type: "unattributed",
        projectId: PROJECT_ID,
      },
      "org-1",
    );

    expect(params.get("q")).toBe("poster");
    expect(params.get("scope")).toBe("workspace");
    expect(params.get("type")).toBe("unattributed");
    expect(params.get("projectId")).toBe(PROJECT_ID);
  });

  it("changes the reset key when any filter changes", () => {
    const base = {
      q: null,
      scope: "owned" as const,
      type: null,
      projectId: null,
    };
    const key = getHistoryFiltersResetKey(base, "org-1");

    expect(getHistoryFiltersResetKey(base, "org-1")).toBe(key);
    expect(
      getHistoryFiltersResetKey({ ...base, type: "job" }, "org-1"),
    ).not.toBe(key);
    expect(getHistoryFiltersResetKey(base, null)).not.toBe(key);
  });
});
