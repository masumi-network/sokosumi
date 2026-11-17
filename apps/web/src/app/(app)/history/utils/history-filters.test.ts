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
  sanitizeHistoryScopeInput,
  sanitizeHistorySearchInput,
  sanitizeHistoryTypeInput,
  sanitizeHistoryUuidInput,
} from "@/app/history/utils/history-filters";
import de from "../../../../../messages/de.json";
import en from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const projectOptions = [{ id: PROJECT_ID, name: "Research" }] as const;

const TASK_ID = "55555555-5555-4555-8555-555555555555";

describe("history-filters", () => {
  it("defaults to owned scope in both personal and organization context", () => {
    expect(getDefaultHistoryScope("org-1")).toBe("owned");
    expect(getDefaultHistoryScope(null)).toBe("owned");
    expect(parseHistoryFilters({}, "org-1")).toEqual({
      q: null,
      scope: "owned",
      type: null,
      projectId: null,
      taskId: null,
    });
  });

  it("covers every consumption source the ledger can return", () => {
    expect([...HISTORY_TYPE_VALUES]).toEqual([
      "job",
      "image",
      "task",
      "coworker",
      "sokoBot",
      "seoChat",
      "contacts",
      "topUp",
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

  it("accepts only a UUID as a project or Task filter", () => {
    expect(sanitizeHistoryUuidInput(PROJECT_ID)).toBe(PROJECT_ID);
    expect(parseHistoryFilters({ taskId: TASK_ID }, null).taskId).toBe(TASK_ID);
    expect(parseHistoryFilters({ taskId: "SOK-12" }, null).taskId).toBeNull();
    expect(sanitizeHistoryUuidInput("not-a-uuid")).toBeNull();
  });

  it("drops a project the caller cannot see", () => {
    expect(
      applyHistoryProjectAllowlist(
        {
          q: null,
          scope: "owned",
          type: null,
          projectId: PROJECT_ID,
          taskId: null,
        },
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
          taskId: null,
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
        taskId: TASK_ID,
      }),
      "org-1",
      projectOptions,
    );

    expect(filters).toEqual({
      q: "poster",
      scope: "workspace",
      type: "image",
      projectId: PROJECT_ID,
      taskId: TASK_ID,
    });
  });

  it("omits the default scope and empty filters from the query string", () => {
    const params = buildHistoryFiltersSearchParams(
      new URLSearchParams(),
      { q: null, scope: "owned", type: null, projectId: null, taskId: null },
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
        taskId: TASK_ID,
      },
      "org-1",
    );

    expect(params.get("q")).toBe("poster");
    expect(params.get("scope")).toBe("workspace");
    expect(params.get("type")).toBe("unattributed");
    expect(params.get("projectId")).toBe(PROJECT_ID);
    expect(params.get("taskId")).toBe(TASK_ID);
  });

  it("changes the reset key when any filter changes", () => {
    const base = {
      q: null,
      scope: "owned" as const,
      type: null,
      projectId: null,
      taskId: null,
    };
    const key = getHistoryFiltersResetKey(base, "org-1");

    expect(getHistoryFiltersResetKey(base, "org-1")).toBe(key);
    expect(
      getHistoryFiltersResetKey({ ...base, type: "job" }, "org-1"),
    ).not.toBe(key);
    expect(
      getHistoryFiltersResetKey({ ...base, taskId: TASK_ID }, "org-1"),
    ).not.toBe(key);
    expect(getHistoryFiltersResetKey(base, null)).not.toBe(key);
  });
});

describe("history source labels", () => {
  it.each([
    ["en", en],
    ["de", de],
    ["es", es],
  ])("%s names every source the filter offers", (_locale, messages) => {
    const kinds = messages.App.TransactionHistory.Row.kind;
    for (const type of HISTORY_TYPE_VALUES) {
      expect(kinds).toHaveProperty(type);
    }
  });
});
