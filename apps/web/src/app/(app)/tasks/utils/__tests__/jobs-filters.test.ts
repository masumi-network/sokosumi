import { AgentJobStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  buildJobsListFiltersSearchParams,
  getJobsListFiltersFromSearchParams,
  getJobsListFiltersResetKey,
  parseJobsListFilters,
  sanitizeAgentJobStatusInput,
  sanitizeJobAgentIdForPersistedFilter,
  sanitizeJobAgentIdInput,
} from "@/app/tasks/utils/jobs-filters";

const agentOptions = [
  {
    id: "agent-1",
    name: "Alpha",
    image: null,
  },
] as const;

describe("jobs-filters", () => {
  it("parses valid jobs filters from App Router search params", () => {
    expect(
      parseJobsListFilters(
        {
          scope: ["workspace", "owned"],
          agentId: ["agent-1", "agent-2"],
          jobStatus: [AgentJobStatus.RUNNING, AgentJobStatus.COMPLETED],
        },
        "org-1",
        agentOptions,
      ),
    ).toEqual({
      scope: "workspace",
      agentId: "agent-1",
      jobStatus: AgentJobStatus.RUNNING,
    });
  });

  it("drops invalid agent and status values", () => {
    expect(
      parseJobsListFilters(
        {
          scope: "workspace",
          agentId: "missing-agent",
          jobStatus: "not-a-status",
        },
        "org-1",
        agentOptions,
      ),
    ).toEqual({
      scope: "workspace",
      agentId: null,
      jobStatus: null,
    });
  });

  it("maps URL search params to filters with an agent allowlist", () => {
    const params = new URLSearchParams({
      scope: "owned",
      agentId: "agent-1",
      jobStatus: AgentJobStatus.COMPLETED,
    });

    expect(
      getJobsListFiltersFromSearchParams(params, "org-1", agentOptions),
    ).toEqual({
      scope: "owned",
      agentId: "agent-1",
      jobStatus: AgentJobStatus.COMPLETED,
    });
  });

  it("builds URL params without losing unrelated query state", () => {
    const currentSearchParams = new URLSearchParams({
      create: "true",
      coworker: "elena",
    });

    const nextSearchParams = buildJobsListFiltersSearchParams(
      currentSearchParams,
      {
        scope: "owned",
        agentId: "agent-1",
        jobStatus: AgentJobStatus.RUNNING,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe(
      "create=true&coworker=elena&scope=owned&agentId=agent-1&jobStatus=RUNNING",
    );
  });

  it("removes default jobs filters from the query string", () => {
    const currentSearchParams = new URLSearchParams({
      agentId: "agent-1",
      jobStatus: AgentJobStatus.COMPLETED,
    });

    const nextSearchParams = buildJobsListFiltersSearchParams(
      currentSearchParams,
      {
        scope: "workspace",
        agentId: null,
        jobStatus: null,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe("");
  });

  it("sanitizes agent ids and job statuses", () => {
    expect(sanitizeJobAgentIdInput(" agent-1 ", agentOptions)).toBe("agent-1");
    expect(sanitizeJobAgentIdInput("missing-agent", agentOptions)).toBeNull();
    expect(sanitizeJobAgentIdInput(null, agentOptions)).toBeNull();

    expect(sanitizeAgentJobStatusInput(` ${AgentJobStatus.FAILED} `)).toBe(
      AgentJobStatus.FAILED,
    );
    expect(sanitizeAgentJobStatusInput("invalid")).toBeNull();
    expect(sanitizeAgentJobStatusInput(null)).toBeNull();
  });

  it("sanitizes persisted job agent ids without an availability allowlist", () => {
    expect(sanitizeJobAgentIdForPersistedFilter(" offline-agent ")).toBe(
      "offline-agent",
    );
    expect(sanitizeJobAgentIdForPersistedFilter(null)).toBeNull();
    expect(sanitizeJobAgentIdForPersistedFilter("   ")).toBeNull();
    expect(sanitizeJobAgentIdForPersistedFilter("a".repeat(129))).toBeNull();
  });

  it("derives stable reset keys for jobs list filters", () => {
    expect(
      getJobsListFiltersResetKey(
        {
          scope: "workspace",
          agentId: "agent-1",
          jobStatus: AgentJobStatus.COMPLETED,
        },
        "org-1",
      ),
    ).toBe("org-1:workspace:agent-1:COMPLETED");
  });
});
