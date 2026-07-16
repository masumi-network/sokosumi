import { AgentJobStatus, JobType, TaskStatus } from "@sokosumi/database";
import { jobForStatusComputeSelect } from "@sokosumi/database/types/job";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectStatsByProjectIds } from "./project-stats";

const { jobFindManyMock, taskGroupByMock } = vi.hoisted(() => ({
  jobFindManyMock: vi.fn(),
  taskGroupByMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      groupBy: taskGroupByMock,
    },
    job: {
      findMany: jobFindManyMock,
    },
  },
}));

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_A_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_B_ID = "22222222-2222-4222-8222-222222222222";

function createFreeJob(
  projectId: string,
  status: AgentJobStatus,
  input: unknown = {},
) {
  return {
    id: `job_${projectId}_${status}`,
    projectId,
    jobType: JobType.FREE,
    events: [
      {
        status,
        input,
      },
    ],
  };
}

describe("getProjectStatsByProjectIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskGroupByMock.mockResolvedValue([]);
    jobFindManyMock.mockResolvedValue([]);
  });

  it("returns zero stats for every requested project when no rows match", async () => {
    const stats = await getProjectStatsByProjectIds(WORKSPACE_ID, [
      PROJECT_A_ID,
      PROJECT_B_ID,
    ]);

    expect(stats).toEqual([
      {
        projectId: PROJECT_A_ID,
        tasks: { total: 0, byStatus: [] },
        jobs: { total: 0, byStatus: [] },
      },
      {
        projectId: PROJECT_B_ID,
        tasks: { total: 0, byStatus: [] },
        jobs: { total: 0, byStatus: [] },
      },
    ]);
  });

  it("aggregates task and computed job status counts by project", async () => {
    taskGroupByMock.mockResolvedValue([
      {
        projectId: PROJECT_A_ID,
        status: TaskStatus.READY,
        _count: { _all: 2 },
      },
      {
        projectId: PROJECT_A_ID,
        status: TaskStatus.COMPLETED,
        _count: { _all: 1 },
      },
      {
        projectId: PROJECT_B_ID,
        status: TaskStatus.RUNNING,
        _count: { _all: 1 },
      },
    ]);
    jobFindManyMock.mockResolvedValue([
      createFreeJob(PROJECT_A_ID, AgentJobStatus.COMPLETED),
      createFreeJob(PROJECT_A_ID, AgentJobStatus.RUNNING),
      createFreeJob(PROJECT_B_ID, AgentJobStatus.AWAITING_INPUT, null),
    ]);

    const stats = await getProjectStatsByProjectIds(WORKSPACE_ID, [
      PROJECT_A_ID,
      PROJECT_B_ID,
    ]);

    expect(stats).toEqual([
      {
        projectId: PROJECT_A_ID,
        tasks: {
          total: 3,
          byStatus: [
            { status: TaskStatus.READY, count: 2 },
            { status: TaskStatus.COMPLETED, count: 1 },
          ],
        },
        jobs: {
          total: 2,
          byStatus: [
            { status: SokosumiJobStatus.COMPLETED, count: 1 },
            { status: SokosumiJobStatus.PROCESSING, count: 1 },
          ],
        },
      },
      {
        projectId: PROJECT_B_ID,
        tasks: {
          total: 1,
          byStatus: [{ status: TaskStatus.RUNNING, count: 1 }],
        },
        jobs: {
          total: 1,
          byStatus: [{ status: SokosumiJobStatus.INPUT_REQUIRED, count: 1 }],
        },
      },
    ]);
  });

  it("filters task and job queries by workspace and requested projects", async () => {
    await getProjectStatsByProjectIds(WORKSPACE_ID, [
      PROJECT_A_ID,
      PROJECT_B_ID,
    ]);

    expect(taskGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          workspaceId: WORKSPACE_ID,
          projectId: { in: [PROJECT_A_ID, PROJECT_B_ID] },
        },
      }),
    );
    expect(jobFindManyMock).toHaveBeenCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        projectId: { in: [PROJECT_A_ID, PROJECT_B_ID] },
      },
      select: jobForStatusComputeSelect,
    });
  });
});
