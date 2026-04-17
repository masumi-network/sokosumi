import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  buildTasksFiltersSearchParams,
  getDefaultTasksScope,
  getTasksFiltersResetKey,
  hasActiveTasksFilters,
  isTaskOwnerEditable,
  parseTasksFilters,
} from "@/app/tasks/utils/tasks-filters";

describe("tasks-filters", () => {
  it("defaults to workspace scope when an organization is active", () => {
    expect(getDefaultTasksScope("org-1")).toBe("workspace");
    expect(parseTasksFilters({}, "org-1")).toEqual({
      scope: "workspace",
      coworkerId: null,
      status: null,
    });
  });

  it("defaults to owned scope in personal context", () => {
    expect(getDefaultTasksScope(null)).toBe("owned");
    expect(parseTasksFilters({}, null)).toEqual({
      scope: "owned",
      coworkerId: null,
      status: null,
    });
  });

  it("coerces invalid workspace scope back to owned in personal context", () => {
    expect(parseTasksFilters({ scope: "workspace" }, null)).toEqual({
      scope: "owned",
      coworkerId: null,
      status: null,
    });
  });

  it("keeps explicit coworker and status filters", () => {
    expect(
      parseTasksFilters(
        {
          scope: "owned",
          coworkerId: "coworker-1",
          status: TaskStatus.READY,
        },
        "org-1",
      ),
    ).toEqual({
      scope: "owned",
      coworkerId: "coworker-1",
      status: TaskStatus.READY,
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
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe(
      "create=true&coworker=elena&scope=owned&coworkerId=coworker-1&status=READY",
    );
  });

  it("removes default filters from the query string", () => {
    const currentSearchParams = new URLSearchParams({
      coworkerId: "coworker-1",
      status: TaskStatus.READY,
    });

    const nextSearchParams = buildTasksFiltersSearchParams(
      currentSearchParams,
      {
        scope: "workspace",
        coworkerId: null,
        status: null,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe("");
  });

  it("tracks active filters against the default scope", () => {
    expect(
      hasActiveTasksFilters(
        {
          scope: "workspace",
          coworkerId: null,
          status: null,
        },
        "org-1",
      ),
    ).toBe(false);
    expect(
      hasActiveTasksFilters(
        {
          scope: "owned",
          coworkerId: null,
          status: null,
        },
        "org-1",
      ),
    ).toBe(true);
  });

  it("derives stable reset keys", () => {
    expect(
      getTasksFiltersResetKey(
        {
          scope: "workspace",
          coworkerId: "coworker-1",
          status: TaskStatus.READY,
        },
        "org-1",
      ),
    ).toBe("org-1:workspace:coworker-1:READY");
  });

  it("allows only owners to edit tasks in workspace scope", () => {
    const task = { userId: "user-1" };

    expect(
      isTaskOwnerEditable(
        task,
        "user-1",
        {
          scope: "workspace",
          coworkerId: null,
          status: null,
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
        },
        null,
      ),
    ).toBe(true);
  });
});
