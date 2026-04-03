import { AgentJobStatus, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { parseTasksRouteFilters } from "../tasks-filters";

describe("parseTasksRouteFilters", () => {
  it("parses valid task and job filters from route params", () => {
    expect(
      parseTasksRouteFilters({
        tab: "jobs",
        memberId: "user-1",
        coworkerId: "coworker-1",
        agentId: "agent-1",
        taskStatus: TaskStatus.RUNNING,
        jobStatus: AgentJobStatus.COMPLETED,
      }),
    ).toEqual({
      tab: "jobs",
      memberId: "user-1",
      coworkerId: "coworker-1",
      agentId: "agent-1",
      taskStatus: TaskStatus.RUNNING,
      jobStatus: AgentJobStatus.COMPLETED,
    });
  });

  it("falls back safely for invalid values", () => {
    expect(
      parseTasksRouteFilters({
        tab: "invalid",
        memberId: " ",
        coworkerId: "",
        agentId: "",
        taskStatus: "invalid",
        jobStatus: "invalid",
      }),
    ).toEqual({
      tab: "tasks",
      memberId: null,
      coworkerId: null,
      agentId: null,
      taskStatus: null,
      jobStatus: null,
    });
  });
});
