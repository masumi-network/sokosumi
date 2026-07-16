import { describe, expect, it } from "vitest";
import {
  applyHistoryProjectAllowlist,
  buildHistoryFiltersSearchParams,
  getDefaultHistoryScope,
  getHistoryFiltersFromSearchParams,
  getHistoryFiltersResetKey,
  getHistoryStatusOptionsForType,
  HISTORY_SEARCH_MAX_LENGTH,
  isHistoryStatusAllowedForType,
  parseHistoryFilters,
  sanitizeHistoryProjectIdInput,
  sanitizeHistoryScopeInput,
  sanitizeHistorySearchInput,
  sanitizeHistoryStatusForType,
  sanitizeHistoryStatusInput,
  sanitizeHistoryTypeInput,
} from "@/app/history/utils/history-filters";
import { SokosumiJobStatus, TaskStatus } from "@/lib/clients/generated/core";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const projectOptions = [{ id: PROJECT_ID, name: "Research" }] as const;

describe("history-filters", () => {
  it("defaults to owned scope when an organization is active", () => {
    expect(getDefaultHistoryScope("org-1")).toBe("owned");
    expect(parseHistoryFilters({}, "org-1")).toEqual({
      q: null,
      scope: "owned",
      type: null,
      status: null,
      projectId: null,
    });
  });

  it("defaults to owned scope in personal context", () => {
    expect(getDefaultHistoryScope(null)).toBe("owned");
    expect(parseHistoryFilters({}, null)).toEqual({
      q: null,
      scope: "owned",
      type: null,
      status: null,
      projectId: null,
    });
  });

  it("coerces workspace scope back to owned in personal context", () => {
    expect(parseHistoryFilters({ scope: "workspace" }, null)).toEqual({
      q: null,
      scope: "owned",
      type: null,
      status: null,
      projectId: null,
    });
  });

  describe("sanitizeHistorySearchInput", () => {
    it("trims empty input and caps q at the API limit", () => {
      expect(sanitizeHistorySearchInput(undefined)).toBeNull();
      expect(sanitizeHistorySearchInput("   ")).toBeNull();
      expect(sanitizeHistorySearchInput("  onboarding  ")).toBe("onboarding");
      expect(sanitizeHistorySearchInput("x".repeat(250))).toHaveLength(
        HISTORY_SEARCH_MAX_LENGTH,
      );
    });
  });

  describe("sanitizeHistoryScopeInput", () => {
    it("returns default scope for non-strings and unknown labels", () => {
      expect(sanitizeHistoryScopeInput(undefined, "org-1")).toBe("owned");
      expect(sanitizeHistoryScopeInput(123, "org-1")).toBe("owned");
      expect(sanitizeHistoryScopeInput("not-a-scope", "org-1")).toBe("owned");
      expect(sanitizeHistoryScopeInput("", "org-1")).toBe("owned");
    });

    it("allows workspace only when an organization is active", () => {
      expect(sanitizeHistoryScopeInput("workspace", "org-1")).toBe("workspace");
      expect(sanitizeHistoryScopeInput("workspace", null)).toBe("owned");
    });
  });

  describe("sanitizeHistoryTypeInput", () => {
    it("accepts history types and drops unknown labels", () => {
      expect(sanitizeHistoryTypeInput("task")).toBe("task");
      expect(sanitizeHistoryTypeInput(" job ")).toBe("job");
      expect(sanitizeHistoryTypeInput("conversation")).toBe("conversation");
      expect(sanitizeHistoryTypeInput("project")).toBeNull();
      expect(sanitizeHistoryTypeInput(null)).toBeNull();
    });
  });

  describe("sanitizeHistoryStatusInput", () => {
    it("accepts active, archived, task statuses, and job-only statuses", () => {
      expect(sanitizeHistoryStatusInput("active")).toBe("active");
      expect(sanitizeHistoryStatusInput(" archived ")).toBe("archived");
      expect(sanitizeHistoryStatusInput(TaskStatus.READY)).toBe(
        TaskStatus.READY,
      );
      expect(
        sanitizeHistoryStatusInput(SokosumiJobStatus.PAYMENT_PENDING),
      ).toBe(SokosumiJobStatus.PAYMENT_PENDING);
      expect(
        sanitizeHistoryStatusInput(SokosumiJobStatus.COMPLETED),
      ).toBeNull();
      expect(sanitizeHistoryStatusInput(TaskStatus.COMPLETED)).toBe(
        TaskStatus.COMPLETED,
      );
      expect(sanitizeHistoryStatusInput("not-a-status")).toBeNull();
      expect(sanitizeHistoryStatusInput(null)).toBeNull();
    });
  });

  describe("sanitizeHistoryProjectIdInput", () => {
    it("accepts UUID strings and drops invalid values", () => {
      expect(sanitizeHistoryProjectIdInput(` ${PROJECT_ID} `)).toBe(PROJECT_ID);
      expect(sanitizeHistoryProjectIdInput("not-a-uuid")).toBeNull();
      expect(sanitizeHistoryProjectIdInput("null")).toBeNull();
      expect(sanitizeHistoryProjectIdInput(null)).toBeNull();
    });
  });

  it("uses the first value when a filter key is repeated", () => {
    expect(
      parseHistoryFilters(
        {
          q: ["first", "second"],
          scope: ["workspace", "owned"],
          type: ["task", "job"],
          status: ["active", TaskStatus.READY],
          projectId: [PROJECT_ID, "44444444-4444-4444-8444-444444444444"],
        },
        "org-1",
      ),
    ).toEqual({
      q: "first",
      scope: "workspace",
      type: "task",
      status: null,
      projectId: PROJECT_ID,
    });
  });

  it("drops conversation-only statuses when type is task or job", () => {
    expect(
      parseHistoryFilters({ type: "task", status: "active" }, "org-1"),
    ).toEqual({
      q: null,
      scope: "owned",
      type: "task",
      status: null,
      projectId: null,
    });

    expect(
      parseHistoryFilters({ type: "job", status: "archived" }, "org-1"),
    ).toEqual({
      q: null,
      scope: "owned",
      type: "job",
      status: null,
      projectId: null,
    });
  });

  describe("getHistoryStatusOptionsForType", () => {
    it("scopes status options to the selected history kind", () => {
      expect(getHistoryStatusOptionsForType("conversation")).toEqual([
        "active",
        "archived",
      ]);
      expect(getHistoryStatusOptionsForType("task")).toContain("archived");
      expect(getHistoryStatusOptionsForType("task")).not.toContain("active");
      expect(getHistoryStatusOptionsForType("job")).toContain(
        SokosumiJobStatus.PAYMENT_PENDING,
      );
      expect(getHistoryStatusOptionsForType("job")).not.toContain("archived");
      expect(getHistoryStatusOptionsForType(null)).toContain("active");
    });
  });

  describe("sanitizeHistoryStatusForType", () => {
    it("keeps compatible statuses and drops incompatible ones", () => {
      expect(sanitizeHistoryStatusForType("active", "conversation")).toBe(
        "active",
      );
      expect(sanitizeHistoryStatusForType("active", "task")).toBeNull();
      expect(sanitizeHistoryStatusForType(TaskStatus.READY, "task")).toBe(
        TaskStatus.READY,
      );
      expect(isHistoryStatusAllowedForType(TaskStatus.READY, "job")).toBe(
        false,
      );
    });
  });

  describe("applyHistoryProjectAllowlist", () => {
    it("clears projectId when it is not in the allowlist", () => {
      expect(
        applyHistoryProjectAllowlist(
          {
            q: null,
            scope: "workspace",
            type: null,
            status: null,
            projectId: PROJECT_ID,
          },
          [{ id: "44444444-4444-4444-8444-444444444444", name: "Other" }],
        ).projectId,
      ).toBeNull();
    });
  });

  it("maps URL search params to filters with project allowlist", () => {
    const params = new URLSearchParams({
      q: "research",
      scope: "owned",
      type: "job",
      status: TaskStatus.COMPLETED,
      projectId: PROJECT_ID,
    });

    expect(
      getHistoryFiltersFromSearchParams(params, "org-1", projectOptions),
    ).toEqual({
      q: "research",
      scope: "owned",
      type: "job",
      status: TaskStatus.COMPLETED,
      projectId: PROJECT_ID,
    });

    expect(
      getHistoryFiltersFromSearchParams(params, "org-1", [
        { id: "44444444-4444-4444-8444-444444444444", name: "Other" },
      ]),
    ).toEqual({
      q: "research",
      scope: "owned",
      type: "job",
      status: TaskStatus.COMPLETED,
      projectId: null,
    });
  });

  it("builds URL params without losing unrelated query state", () => {
    const currentSearchParams = new URLSearchParams({
      create: "true",
    });

    const nextSearchParams = buildHistoryFiltersSearchParams(
      currentSearchParams,
      {
        q: "research",
        scope: "owned",
        type: "task",
        status: TaskStatus.READY,
        projectId: PROJECT_ID,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe(
      "create=true&q=research&type=task&status=READY&projectId=33333333-3333-4333-8333-333333333333",
    );
  });

  it("removes default filters from the query string", () => {
    const currentSearchParams = new URLSearchParams({
      q: "research",
      scope: "owned",
      type: "task",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });

    const nextSearchParams = buildHistoryFiltersSearchParams(
      currentSearchParams,
      {
        q: null,
        scope: "owned",
        type: null,
        status: null,
        projectId: null,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe("");
  });

  it("derives stable reset keys", () => {
    expect(
      getHistoryFiltersResetKey(
        {
          q: "research",
          scope: "workspace",
          type: "conversation",
          status: "archived",
          projectId: PROJECT_ID,
        },
        "org-1",
      ),
    ).toBe(
      "org-1:research:workspace:conversation:archived:33333333-3333-4333-8333-333333333333",
    );
  });
});
