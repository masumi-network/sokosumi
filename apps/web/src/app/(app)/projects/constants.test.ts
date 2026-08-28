import { describe, expect, it } from "vitest";

import {
  PROJECTS_BROWSE_LAYOUT_CLASS,
  PROJECTS_ITEM_LAYOUT_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
  UNASSIGNED_PROJECT_QUERY,
  unassignedWorkspaceJobsQuery,
  unassignedWorkspaceTasksQuery,
} from "@/app/projects/constants";
import type {
  GetJobsData,
  GetTasksData,
} from "@/lib/clients/generated/core/types.gen";

describe("projects list CLS layout constants", () => {
  it("exports full Tailwind class strings for scanner + Instant pairing", () => {
    expect(PROJECTS_LIST_CARD_MIN_H_CLASS).toBe("min-h-[320px]");
    expect(PROJECTS_LIST_ROW_LAYOUT_CLASS).toBe(
      "[content-visibility:auto] [contain-intrinsic-size:auto_72px]",
    );
    expect(PROJECTS_ITEM_LAYOUT_CLASS).toBe(
      "[content-visibility:auto] [contain-intrinsic-size:auto_148px] md:[contain-intrinsic-size:auto_72px]",
    );
    expect(PROJECTS_BROWSE_LAYOUT_CLASS).toContain("grid-cols-2");
    expect(PROJECTS_BROWSE_LAYOUT_CLASS).toContain("md:grid-cols-1");
  });
});

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
