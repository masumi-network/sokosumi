import type { GetJobsData, GetTasksData } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  UNASSIGNED_PROJECT_QUERY,
  unassignedWorkspaceJobsQuery,
  unassignedWorkspaceTasksQuery,
} from "@/app/projects/constants";

describe("UNASSIGNED_PROJECT_QUERY", () => {
  it("matches the Core API query param for unassigned project filters", () => {
    const query: NonNullable<GetJobsData["query"]> = {
      projectId: UNASSIGNED_PROJECT_QUERY,
    };

    expect(query.projectId).toBe("null");
  });
});

describe("unassignedWorkspaceJobsQuery", () => {
  it("requests workspace jobs with projectId=null (not omitted)", () => {
    const query = unassignedWorkspaceJobsQuery({ limit: 50 });

    expect(query).toEqual({
      scope: "workspace",
      projectId: "null",
      limit: 50,
    });
  });

  it("differs from omitting projectId, which lists all workspace jobs", () => {
    const unassignedQuery = unassignedWorkspaceJobsQuery();
    const allJobsQuery: NonNullable<GetJobsData["query"]> = {
      scope: "workspace",
    };

    expect(unassignedQuery.projectId).toBe("null");
    expect(allJobsQuery.projectId).toBeUndefined();
  });
});

describe("unassignedWorkspaceTasksQuery", () => {
  it("requests workspace tasks with projectId=null (not omitted)", () => {
    const query = unassignedWorkspaceTasksQuery({
      q: "review",
      limit: 25,
    });

    expect(query).toEqual({
      scope: "workspace",
      projectId: "null",
      q: "review",
      limit: 25,
    });
  });

  it("differs from omitting projectId, which lists all workspace tasks", () => {
    const unassignedQuery = unassignedWorkspaceTasksQuery();
    const allTasksQuery: NonNullable<GetTasksData["query"]> = {
      scope: "workspace",
    };

    expect(unassignedQuery.projectId).toBe("null");
    expect(allTasksQuery.projectId).toBeUndefined();
  });
});
