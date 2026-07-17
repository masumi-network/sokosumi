import { describe, expect, it } from "vitest";
import {
  buildTasksFiltersSearchParams,
  getDefaultTasksScope,
  getTasksFiltersFromSearchParams,
  getTasksFiltersResetKey,
  hasActiveTasksFilters,
  isTaskDraggableForViewFilters,
  isTaskOwnerEditable,
  parseTasksFilters,
  sanitizeProjectIdFilterInput,
  sanitizeTasksScopeInput,
  sanitizeTasksStatusInput,
} from "@/app/tasks/utils/tasks-filters";
import { TaskStatus } from "@/lib/clients/generated/core";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const projectOptions = [{ id: PROJECT_ID, name: "Research" }] as const;

describe("tasks-filters", () => {
  it("defaults to owned scope when an organization is active", () => {
    expect(getDefaultTasksScope("org-1")).toBe("owned");
    expect(parseTasksFilters({}, "org-1")).toEqual({
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
    });
  });

  it("defaults to owned scope in personal context", () => {
    expect(getDefaultTasksScope(null)).toBe("owned");
    expect(parseTasksFilters({}, null)).toEqual({
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
    });
  });

  it("coerces invalid workspace scope back to owned in personal context", () => {
    expect(parseTasksFilters({ scope: "workspace" }, null)).toEqual({
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
    });
  });

  describe("sanitizeTasksScopeInput", () => {
    it("returns default scope for non-strings and unknown labels", () => {
      expect(sanitizeTasksScopeInput(undefined, "org-1")).toBe("owned");
      expect(sanitizeTasksScopeInput(123, "org-1")).toBe("owned");
      expect(sanitizeTasksScopeInput("not-a-scope", "org-1")).toBe("owned");
      expect(sanitizeTasksScopeInput("", "org-1")).toBe("owned");
    });

    it("allows workspace only when an organization is active", () => {
      expect(sanitizeTasksScopeInput("workspace", "org-1")).toBe("workspace");
      expect(sanitizeTasksScopeInput("workspace", null)).toBe("owned");
    });
  });

  describe("sanitizeTasksStatusInput", () => {
    it("returns null for non-strings and unknown labels", () => {
      expect(sanitizeTasksStatusInput(undefined)).toBeNull();
      expect(sanitizeTasksStatusInput(null)).toBeNull();
      expect(sanitizeTasksStatusInput(123)).toBeNull();
      expect(sanitizeTasksStatusInput({})).toBeNull();
      expect(sanitizeTasksStatusInput("not-a-status")).toBeNull();
      expect(sanitizeTasksStatusInput("")).toBeNull();
      expect(sanitizeTasksStatusInput("   ")).toBeNull();
    });

    it("accepts valid TaskStatus string values", () => {
      expect(sanitizeTasksStatusInput(TaskStatus.READY)).toBe(TaskStatus.READY);
      expect(sanitizeTasksStatusInput(` ${TaskStatus.DRAFT} `)).toBe(
        TaskStatus.DRAFT,
      );
    });
  });

  describe("sanitizeProjectIdFilterInput", () => {
    it("accepts UUID strings and drops invalid values", () => {
      expect(sanitizeProjectIdFilterInput(` ${PROJECT_ID} `)).toBe(PROJECT_ID);
      expect(sanitizeProjectIdFilterInput("not-a-uuid")).toBeNull();
      expect(sanitizeProjectIdFilterInput("null")).toBeNull();
      expect(sanitizeProjectIdFilterInput(null)).toBeNull();
    });
  });

  it("maps URL search params to filters with coworker allowlist", () => {
    const params = new URLSearchParams({
      scope: "owned",
      coworkerId: "coworker-1",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });

    expect(
      getTasksFiltersFromSearchParams(params, "org-1", [{ id: "coworker-1" }]),
    ).toEqual({
      scope: "owned",
      coworkerId: "coworker-1",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });

    expect(
      getTasksFiltersFromSearchParams(params, "org-1", [{ id: "other" }]),
    ).toEqual({
      scope: "owned",
      coworkerId: null,
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });
  });

  it("maps URL search params to filters with project allowlist", () => {
    const params = new URLSearchParams({
      projectId: PROJECT_ID,
    });

    expect(
      getTasksFiltersFromSearchParams(params, "org-1", [], projectOptions),
    ).toEqual({
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: PROJECT_ID,
    });

    expect(
      getTasksFiltersFromSearchParams(
        params,
        "org-1",
        [],
        [{ id: "44444444-4444-4444-8444-444444444444", name: "Other" }],
      ),
    ).toEqual({
      scope: "owned",
      coworkerId: null,
      status: null,
      projectId: null,
    });
  });

  it("keeps explicit coworker and status filters", () => {
    expect(
      parseTasksFilters(
        {
          scope: "owned",
          coworkerId: "coworker-1",
          status: TaskStatus.READY,
          projectId: PROJECT_ID,
        },
        "org-1",
      ),
    ).toEqual({
      scope: "owned",
      coworkerId: "coworker-1",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });
  });

  it("uses the first value when a filter key is repeated (App Router searchParams)", () => {
    expect(
      parseTasksFilters(
        {
          scope: ["workspace", "owned"],
          coworkerId: ["coworker-1", "coworker-2"],
          status: [TaskStatus.READY, TaskStatus.FAILED],
          projectId: [PROJECT_ID, "44444444-4444-4444-8444-444444444444"],
        },
        "org-1",
      ),
    ).toEqual({
      scope: "workspace",
      coworkerId: "coworker-1",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });
  });

  it("builds URL params without losing unrelated query state", () => {
    const currentSearchParams = new URLSearchParams({
      create: "true",
      coworker: "elena",
    });

    const nextSearchParams = buildTasksFiltersSearchParams(
      currentSearchParams,
      {
        scope: "owned",
        coworkerId: "coworker-1",
        status: TaskStatus.READY,
        projectId: PROJECT_ID,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe(
      "create=true&coworker=elena&coworkerId=coworker-1&status=READY&projectId=33333333-3333-4333-8333-333333333333",
    );
  });

  it("removes default filters from the query string", () => {
    const currentSearchParams = new URLSearchParams({
      coworkerId: "coworker-1",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });

    const nextSearchParams = buildTasksFiltersSearchParams(
      currentSearchParams,
      {
        scope: "workspace",
        coworkerId: null,
        status: null,
        projectId: null,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe("scope=workspace");
  });

  it("derives stable reset keys", () => {
    expect(
      getTasksFiltersResetKey(
        {
          scope: "workspace",
          coworkerId: "coworker-1",
          status: TaskStatus.READY,
          projectId: PROJECT_ID,
        },
        "org-1",
      ),
    ).toBe(
      "org-1:workspace:coworker-1:READY:33333333-3333-4333-8333-333333333333",
    );
  });

  it("allows only owners to edit tasks in workspace scope", () => {
    const task = { ownerId: "user-1" };

    expect(
      isTaskOwnerEditable(
        task,
        "user-1",
        {
          scope: "workspace",
          coworkerId: null,
          status: null,
          projectId: null,
        },
        "org-1",
      ),
    ).toBe(true);
    expect(
      isTaskOwnerEditable(
        task,
        "user-2",
        {
          scope: "workspace",
          coworkerId: null,
          status: null,
          projectId: null,
        },
        "org-1",
      ),
    ).toBe(false);
    expect(
      isTaskOwnerEditable(
        task,
        "user-2",
        {
          scope: "owned",
          coworkerId: null,
          status: null,
          projectId: null,
        },
        null,
      ),
    ).toBe(true);
  });

  describe("hasActiveTasksFilters", () => {
    const defaultFilters = {
      scope: "owned" as const,
      coworkerId: null,
      status: null,
      projectId: null,
    };

    it("shows the indicator for org boards with owned scope (default)", () => {
      expect(hasActiveTasksFilters(defaultFilters, "org-1")).toBe(true);
    });

    it("shows the indicator for org boards with workspace scope", () => {
      expect(
        hasActiveTasksFilters(
          { ...defaultFilters, scope: "workspace" },
          "org-1",
        ),
      ).toBe(true);
    });

    it("hides the indicator for personal boards with owned scope only", () => {
      expect(hasActiveTasksFilters(defaultFilters, null)).toBe(false);
    });

    it("shows the indicator for personal boards with status filter", () => {
      expect(
        hasActiveTasksFilters(
          { ...defaultFilters, status: TaskStatus.READY },
          null,
        ),
      ).toBe(true);
    });

    it("shows the indicator for personal boards with coworker filter", () => {
      expect(
        hasActiveTasksFilters(
          { ...defaultFilters, coworkerId: "coworker-1" },
          null,
        ),
      ).toBe(true);
    });

    it("shows the indicator for personal boards with project filter", () => {
      expect(
        hasActiveTasksFilters(
          { ...defaultFilters, projectId: PROJECT_ID },
          null,
        ),
      ).toBe(true);
    });
  });

  describe("isTaskDraggableForViewFilters", () => {
    const workspaceFilters = {
      scope: "workspace" as const,
      coworkerId: null,
      status: null,
      projectId: null,
    };
    const ownedFilters = {
      scope: "owned" as const,
      coworkerId: null,
      status: null,
      projectId: null,
    };

    it("disallows drag when the URL implies owned but the server list was still workspace (coworker task)", () => {
      const coworkerTask = { ownerId: "user-2" };

      expect(
        isTaskDraggableForViewFilters(
          coworkerTask,
          "user-1",
          ownedFilters,
          workspaceFilters,
          "org-1",
        ),
      ).toBe(false);
    });

    it("allows drag when route and initial filters agree for the viewer's task", () => {
      const myTask = { ownerId: "user-1" };

      expect(
        isTaskDraggableForViewFilters(
          myTask,
          "user-1",
          ownedFilters,
          ownedFilters,
          "org-1",
        ),
      ).toBe(true);
    });
  });
});
