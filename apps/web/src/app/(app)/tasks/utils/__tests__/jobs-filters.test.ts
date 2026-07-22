import { describe, expect, it } from "vitest";
import {
  buildJobsListFiltersSearchParams,
  getJobsListFiltersForLazyAgentCatalog,
  getJobsListFiltersFromSearchParams,
  getJobsListFiltersResetKey,
  mergeTopPageJobsWithListFilters,
  parseJobsListFilters,
  sanitizeAgentJobStatusInput,
  sanitizeJobAgentIdForPersistedFilter,
  sanitizeJobAgentIdInput,
  tasksViewJobStillEligibleForJobsListFilters,
} from "@/app/tasks/utils/jobs-filters";
import {
  AgentJobStatus,
  SokosumiJobStatus,
} from "@/lib/clients/generated/core";

const agentOptions = [
  {
    id: "agent-1",
    name: "Alpha",
    image: null,
  },
] as const;
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const projectOptions = [{ id: PROJECT_ID, name: "Research" }] as const;

describe("jobs-filters", () => {
  it("parses valid jobs filters from App Router search params", () => {
    expect(
      parseJobsListFilters(
        {
          scope: ["workspace", "owned"],
          agentId: ["agent-1", "agent-2"],
          jobStatus: [AgentJobStatus.RUNNING, AgentJobStatus.COMPLETED],
          projectId: [PROJECT_ID, "44444444-4444-4444-8444-444444444444"],
        },
        "org-1",
        agentOptions,
      ),
    ).toEqual({
      scope: "workspace",
      agentId: "agent-1",
      jobStatus: AgentJobStatus.RUNNING,
      projectId: PROJECT_ID,
    });
  });

  it("drops invalid agent and status values", () => {
    expect(
      parseJobsListFilters(
        {
          scope: "workspace",
          agentId: "missing-agent",
          jobStatus: "not-a-status",
          projectId: "not-a-project",
        },
        "org-1",
        agentOptions,
      ),
    ).toEqual({
      scope: "workspace",
      agentId: null,
      jobStatus: null,
      projectId: null,
    });
  });

  it("maps URL search params to filters with an agent allowlist", () => {
    const params = new URLSearchParams({
      scope: "owned",
      agentId: "agent-1",
      jobStatus: AgentJobStatus.COMPLETED,
      projectId: PROJECT_ID,
    });

    expect(
      getJobsListFiltersFromSearchParams(params, "org-1", agentOptions),
    ).toEqual({
      scope: "owned",
      agentId: "agent-1",
      jobStatus: AgentJobStatus.COMPLETED,
      projectId: PROJECT_ID,
    });
  });

  it("keeps URL agentId while the lazy jobs agent catalog is empty", () => {
    const params = new URLSearchParams({
      scope: "owned",
      agentId: "agent-from-url",
      jobStatus: AgentJobStatus.RUNNING,
    });

    expect(getJobsListFiltersForLazyAgentCatalog(params, "org-1", [])).toEqual({
      scope: "owned",
      agentId: "agent-from-url",
      jobStatus: AgentJobStatus.RUNNING,
      projectId: null,
    });

    expect(
      getJobsListFiltersForLazyAgentCatalog(params, "org-1", agentOptions),
    ).toEqual({
      scope: "owned",
      agentId: null,
      jobStatus: AgentJobStatus.RUNNING,
      projectId: null,
    });
  });

  it("maps URL search params to filters with a project allowlist", () => {
    const params = new URLSearchParams({
      projectId: PROJECT_ID,
    });

    expect(
      getJobsListFiltersFromSearchParams(
        params,
        "org-1",
        agentOptions,
        projectOptions,
      ),
    ).toEqual({
      scope: "owned",
      agentId: null,
      jobStatus: null,
      projectId: PROJECT_ID,
    });

    expect(
      getJobsListFiltersFromSearchParams(params, "org-1", agentOptions, [
        { id: "44444444-4444-4444-8444-444444444444", name: "Other" },
      ]),
    ).toEqual({
      scope: "owned",
      agentId: null,
      jobStatus: null,
      projectId: null,
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
        projectId: PROJECT_ID,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe(
      "create=true&coworker=elena&agentId=agent-1&jobStatus=RUNNING&projectId=33333333-3333-4333-8333-333333333333",
    );
  });

  it("removes default jobs filters from the query string", () => {
    const currentSearchParams = new URLSearchParams({
      agentId: "agent-1",
      jobStatus: AgentJobStatus.COMPLETED,
      projectId: PROJECT_ID,
    });

    const nextSearchParams = buildJobsListFiltersSearchParams(
      currentSearchParams,
      {
        scope: "workspace",
        agentId: null,
        jobStatus: null,
        projectId: null,
      },
      "org-1",
    );

    expect(nextSearchParams.toString()).toBe("scope=workspace");
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
          projectId: PROJECT_ID,
        },
        "org-1",
      ),
    ).toBe(
      "org-1:workspace:agent-1:COMPLETED:33333333-3333-4333-8333-333333333333",
    );
  });

  describe("tasksViewJobStillEligibleForJobsListFilters", () => {
    const baseJob = {
      id: "job-1",
      agentId: "agent-1",
      status: SokosumiJobStatus.PROCESSING,
    };

    it("drops jobs that no longer match the agent filter", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(baseJob, {
          scope: "workspace",
          agentId: "agent-2",
          jobStatus: AgentJobStatus.RUNNING,
          projectId: null,
        }),
      ).toBe(false);
    });

    it("treats completed jobs as ineligible when filtering to RUNNING", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(
          { ...baseJob, status: SokosumiJobStatus.COMPLETED },
          {
            scope: "workspace",
            agentId: null,
            jobStatus: AgentJobStatus.RUNNING,
            projectId: null,
          },
        ),
      ).toBe(false);
    });

    it("keeps in-progress jobs when filtering to RUNNING", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(baseJob, {
          scope: "workspace",
          agentId: null,
          jobStatus: AgentJobStatus.RUNNING,
          projectId: null,
        }),
      ).toBe(true);
    });

    it("treats processing jobs as ineligible when filtering to AWAITING_INPUT", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(baseJob, {
          scope: "workspace",
          agentId: null,
          jobStatus: AgentJobStatus.AWAITING_INPUT,
          projectId: null,
        }),
      ).toBe(false);
    });

    it("keeps input-required jobs when filtering to AWAITING_INPUT", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(
          { ...baseJob, status: SokosumiJobStatus.INPUT_REQUIRED },
          {
            scope: "workspace",
            agentId: null,
            jobStatus: AgentJobStatus.AWAITING_INPUT,
            projectId: null,
          },
        ),
      ).toBe(true);
    });

    it("treats result-pending jobs as ineligible when filtering to AWAITING_INPUT", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(
          { ...baseJob, status: SokosumiJobStatus.RESULT_PENDING },
          {
            scope: "workspace",
            agentId: null,
            jobStatus: AgentJobStatus.AWAITING_INPUT,
            projectId: null,
          },
        ),
      ).toBe(false);
    });

    it("keeps payment-failed jobs when filtering to FAILED", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(
          { ...baseJob, status: SokosumiJobStatus.PAYMENT_FAILED },
          {
            scope: "workspace",
            agentId: null,
            jobStatus: AgentJobStatus.FAILED,
            projectId: null,
          },
        ),
      ).toBe(true);
    });

    it("keeps started jobs when filtering to AWAITING_PAYMENT", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(
          { ...baseJob, status: SokosumiJobStatus.STARTED },
          {
            scope: "workspace",
            agentId: null,
            jobStatus: AgentJobStatus.AWAITING_PAYMENT,
            projectId: null,
          },
        ),
      ).toBe(true);
    });

    it("treats processing jobs as ineligible when filtering to AWAITING_PAYMENT", () => {
      expect(
        tasksViewJobStillEligibleForJobsListFilters(baseJob, {
          scope: "workspace",
          agentId: null,
          jobStatus: AgentJobStatus.AWAITING_PAYMENT,
          projectId: null,
        }),
      ).toBe(false);
    });
  });

  describe("mergeTopPageJobsWithListFilters", () => {
    it("preserves deeper pages when no narrowing filters are set", () => {
      const prev = [
        { id: "a", agentId: "x", status: SokosumiJobStatus.PROCESSING },
        { id: "b", agentId: "x", status: SokosumiJobStatus.COMPLETED },
      ];
      const refreshed = [
        { id: "c", agentId: "x", status: SokosumiJobStatus.PROCESSING },
      ];
      expect(
        mergeTopPageJobsWithListFilters(prev, refreshed, {
          scope: "workspace",
          agentId: null,
          jobStatus: null,
          projectId: null,
        }),
      ).toEqual([refreshed[0], prev[0], prev[1]]);
    });

    it("drops tail jobs that cannot match an active job-status filter", () => {
      const prev = [
        { id: "running", agentId: "x", status: SokosumiJobStatus.PROCESSING },
        { id: "done", agentId: "x", status: SokosumiJobStatus.COMPLETED },
      ];
      const refreshed = [
        { id: "running", agentId: "x", status: SokosumiJobStatus.COMPLETED },
      ];
      expect(
        mergeTopPageJobsWithListFilters(prev, refreshed, {
          scope: "workspace",
          agentId: null,
          jobStatus: AgentJobStatus.RUNNING,
          projectId: null,
        }),
      ).toEqual([refreshed[0]]);
    });

    it("drops stale processing tail rows when filtering to AWAITING_INPUT", () => {
      const prev = [
        {
          id: "needs-input",
          agentId: "x",
          status: SokosumiJobStatus.INPUT_REQUIRED,
        },
        { id: "stale", agentId: "x", status: SokosumiJobStatus.PROCESSING },
      ];
      const refreshed = [
        {
          id: "needs-input",
          agentId: "x",
          status: SokosumiJobStatus.INPUT_REQUIRED,
        },
      ];
      expect(
        mergeTopPageJobsWithListFilters(prev, refreshed, {
          scope: "workspace",
          agentId: null,
          jobStatus: AgentJobStatus.AWAITING_INPUT,
          projectId: null,
        }),
      ).toEqual([refreshed[0]]);
    });

    it("preserves payment-failed tail rows when filtering to FAILED", () => {
      const prev = [
        { id: "failed-job", agentId: "x", status: SokosumiJobStatus.FAILED },
        {
          id: "payment-failed",
          agentId: "x",
          status: SokosumiJobStatus.PAYMENT_FAILED,
        },
      ];
      const refreshed = [
        { id: "failed-job", agentId: "x", status: SokosumiJobStatus.FAILED },
      ];
      expect(
        mergeTopPageJobsWithListFilters(prev, refreshed, {
          scope: "workspace",
          agentId: null,
          jobStatus: AgentJobStatus.FAILED,
          projectId: null,
        }),
      ).toEqual([refreshed[0], prev[1]]);
    });

    it("preserves started tail rows when filtering to AWAITING_PAYMENT", () => {
      const prev = [
        {
          id: "pending",
          agentId: "x",
          status: SokosumiJobStatus.PAYMENT_PENDING,
        },
        { id: "started", agentId: "x", status: SokosumiJobStatus.STARTED },
      ];
      const refreshed = [
        {
          id: "pending",
          agentId: "x",
          status: SokosumiJobStatus.PAYMENT_PENDING,
        },
      ];
      expect(
        mergeTopPageJobsWithListFilters(prev, refreshed, {
          scope: "workspace",
          agentId: null,
          jobStatus: AgentJobStatus.AWAITING_PAYMENT,
          projectId: null,
        }),
      ).toEqual([refreshed[0], prev[1]]);
    });
  });
});
