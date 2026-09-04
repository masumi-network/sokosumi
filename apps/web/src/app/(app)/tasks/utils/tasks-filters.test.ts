import { describe, expect, it } from "vitest";
import {
  applyProjectIdSearchParam,
  buildTasksFiltersSearchParams,
  getDefaultTasksScope,
  getTasksFiltersFromSearchParams,
  getTasksFiltersResetKey,
  hasActiveTasksFilters,
  isTaskDraggableForViewFilters,
  isTaskOwnerEditable,
  mergeProjectFilterOptions,
  parseTasksFilters,
  sanitizeProjectIdFilterInput,
  sanitizeTasksScopeInput,
  sanitizeTasksStatusInput,
} from "@/app/tasks/utils/tasks-filters";
import { TaskStatus } from "@/lib/clients/generated/core";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const projectOptions = [{ id: PROJECT_ID, name: "Research" }] as const;

describe("tasks-filters", () => {
  it("defaults to workspace scope when an organization is active", () => {
    expect(getDefaultTasksScope("org-1")).toBe("workspace");
    expect(parseTasksFilters({}, "org-1")).toEqual({
      scope: "workspace",
      assigneeId: null,
      assigneeSokoBotId: null,
      status: null,
      projectId: null,
    });
  });

  it("defaults to owned scope in personal context", () => {
    expect(getDefaultTasksScope(null)).toBe("owned");
    expect(parseTasksFilters({}, null)).toEqual({
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      status: null,
      projectId: null,
    });
  });

  it("coerces invalid workspace scope back to owned in personal context", () => {
    expect(parseTasksFilters({ scope: "workspace" }, null)).toEqual({
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
      status: null,
      projectId: null,
    });
  });

  describe("sanitizeTasksScopeInput", () => {
    it("returns default scope for non-strings and unknown labels", () => {
      // In an org the default is now workspace.
      expect(sanitizeTasksScopeInput(undefined, "org-1")).toBe("workspace");
      expect(sanitizeTasksScopeInput(123, "org-1")).toBe("workspace");
      expect(sanitizeTasksScopeInput("not-a-scope", "org-1")).toBe("workspace");
      expect(sanitizeTasksScopeInput("", "org-1")).toBe("workspace");
      // Personal context stays on owned.
      expect(sanitizeTasksScopeInput("not-a-scope", null)).toBe("owned");
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
      assigneeId: "coworker-1",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });

    expect(
      getTasksFiltersFromSearchParams(params, "org-1", [{ id: "coworker-1" }]),
    ).toEqual({
      scope: "owned",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });

    expect(
      getTasksFiltersFromSearchParams(params, "org-1", [{ id: "other" }]),
    ).toEqual({
      scope: "owned",
      assigneeId: null,
      assigneeSokoBotId: null,
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
      scope: "workspace",
      assigneeId: null,
      assigneeSokoBotId: null,
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
      scope: "workspace",
      assigneeId: null,
      assigneeSokoBotId: null,
      status: null,
      projectId: null,
    });
  });

  it("keeps explicit coworker and status filters", () => {
    expect(
      parseTasksFilters(
        {
          scope: "owned",
          assigneeId: "coworker-1",
          status: TaskStatus.READY,
          projectId: PROJECT_ID,
        },
        "org-1",
      ),
    ).toEqual({
      scope: "owned",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });
  });

  it("uses the first value when a filter key is repeated (App Router searchParams)", () => {
    expect(
      parseTasksFilters(
        {
          scope: ["workspace", "owned"],
          assigneeId: ["coworker-1", "coworker-2"],
          status: [TaskStatus.READY, TaskStatus.FAILED],
          projectId: [PROJECT_ID, "44444444-4444-4444-8444-444444444444"],
        },
        "org-1",
      ),
    ).toEqual({
      scope: "workspace",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
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
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        status: TaskStatus.READY,
        projectId: PROJECT_ID,
      },
      "org-1",
    );

    // `owned` is now the non-default in an org, so it is written explicitly.
    expect(nextSearchParams.toString()).toBe(
      "create=true&coworker=elena&scope=owned&assigneeId=coworker-1&status=READY&projectId=33333333-3333-4333-8333-333333333333",
    );
  });

  it("parses legacy coworkerId query param when assigneeId is absent", () => {
    expect(
      parseTasksFilters(
        {
          coworkerId: "coworker-1",
        },
        "org-1",
      ),
    ).toEqual({
      scope: "workspace",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      status: null,
      projectId: null,
    });
  });

  it("removes default filters from the query string", () => {
    const currentSearchParams = new URLSearchParams({
      assigneeId: "coworker-1",
      status: TaskStatus.READY,
      projectId: PROJECT_ID,
    });

    const nextSearchParams = buildTasksFiltersSearchParams(
      currentSearchParams,
      {
        scope: "workspace",
        assigneeId: null,
        assigneeSokoBotId: null,
        status: null,
        projectId: null,
      },
      "org-1",
    );

    // `workspace` is now the org default, so it is dropped from the URL.
    expect(nextSearchParams.toString()).toBe("");
  });

  it("derives stable reset keys", () => {
    expect(
      getTasksFiltersResetKey(
        {
          scope: "workspace",
          assigneeId: "coworker-1",
          assigneeSokoBotId: null,
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
          assigneeId: null,
          assigneeSokoBotId: null,
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
          assigneeId: null,
          assigneeSokoBotId: null,
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
          assigneeId: null,
          assigneeSokoBotId: null,
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
      assigneeId: null,
      assigneeSokoBotId: null,
      status: null,
      projectId: null,
    };

    it("shows the indicator for org boards with owned scope", () => {
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
          { ...defaultFilters, assigneeId: "coworker-1" },
          null,
        ),
      ).toBe(true);
    });

    it("does not treat project scope as a Filters-panel indicator", () => {
      expect(
        hasActiveTasksFilters(
          { ...defaultFilters, projectId: PROJECT_ID },
          null,
        ),
      ).toBe(false);
    });
  });

  describe("applyProjectIdSearchParam", () => {
    it("sets and clears projectId without touching other params", () => {
      const current = new URLSearchParams("status=READY&agentId=agent-1");

      const withProject = applyProjectIdSearchParam(current, PROJECT_ID);
      expect(withProject.get("projectId")).toBe(PROJECT_ID);
      expect(withProject.get("status")).toBe("READY");
      expect(withProject.get("agentId")).toBe("agent-1");

      const cleared = applyProjectIdSearchParam(withProject, null);
      expect(cleared.get("projectId")).toBeNull();
      expect(cleared.get("status")).toBe("READY");
    });
  });

  describe("mergeProjectFilterOptions", () => {
    it("keeps server options first and appends unseen created projects", () => {
      expect(
        mergeProjectFilterOptions(projectOptions, [
          { id: PROJECT_ID, name: "Stale" },
          { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "New" },
        ]),
      ).toEqual([
        { id: PROJECT_ID, name: "Research" },
        { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "New" },
      ]);
    });
  });

  describe("isTaskDraggableForViewFilters", () => {
    const workspaceFilters = {
      scope: "workspace" as const,
      assigneeId: null,
      assigneeSokoBotId: null,
      status: null,
      projectId: null,
    };
    const ownedFilters = {
      scope: "owned" as const,
      assigneeId: null,
      assigneeSokoBotId: null,
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

    it("gives a valid soko bot filter precedence over a valid coworker filter", () => {
      const params = new URLSearchParams({
        assigneeId: "coworker-1",
        assigneeSokoBotId: "bot-1",
      });

      expect(
        getTasksFiltersFromSearchParams(params, "org-1", [
          { id: "coworker-1" },
          { id: "bot-1", kind: "sokoBot" },
        ]),
      ).toEqual({
        scope: "workspace",
        assigneeId: null,
        assigneeSokoBotId: "bot-1",
        status: null,
        projectId: null,
      });
    });

    it("rejects a personal-assistant id in assigneeId and keeps soko bot filter", () => {
      const params = new URLSearchParams({
        assigneeId: "bot-1",
        assigneeSokoBotId: "bot-1",
      });

      expect(
        getTasksFiltersFromSearchParams(params, "org-1", [
          { id: "coworker-1" },
          { id: "bot-1", kind: "sokoBot" },
        ]),
      ).toEqual({
        scope: "workspace",
        assigneeId: null,
        assigneeSokoBotId: "bot-1",
        status: null,
        projectId: null,
      });
    });

    it("serializes soko bot assignee filters onto assigneeSokoBotId", () => {
      const nextSearchParams = buildTasksFiltersSearchParams(
        new URLSearchParams(),
        {
          scope: "workspace",
          assigneeId: null,
          assigneeSokoBotId: "bot-1",
          status: null,
          projectId: null,
        },
        "org-1",
      );

      expect(nextSearchParams.toString()).toBe("assigneeSokoBotId=bot-1");
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
