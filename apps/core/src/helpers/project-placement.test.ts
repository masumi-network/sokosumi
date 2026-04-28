import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assignJobToProject, assignTaskToProject } from "./project-placement";

describe("project-placement", () => {
  const projectFindFirst = vi.fn();
  const taskUpdateMany = vi.fn();
  const jobUpdateMany = vi.fn();
  const jobFindFirst = vi.fn();
  const taskFindFirst = vi.fn();

  const tx = {
    project: { findFirst: projectFindFirst },
    task: { updateMany: taskUpdateMany, findFirst: taskFindFirst },
    job: { updateMany: jobUpdateMany, findFirst: jobFindFirst },
  };

  const workspaceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirst.mockResolvedValue({
      workspaceId,
    });
    taskUpdateMany.mockResolvedValue({ count: 1 });
    jobUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("assignTaskToProject sets workspaceId from project", async () => {
    await assignTaskToProject(tx as never, {
      taskId: "tsk_1",
      projectId: "prj_1",
      workspaceId,
    });

    expect(projectFindFirst).toHaveBeenCalledWith({
      where: { id: "prj_1", workspaceId },
      select: { workspaceId: true },
    });
    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "tsk_1",
        workspaceId,
        archivedAt: null,
        OR: [{ projectId: null }, { projectId: "prj_1" }],
      },
      data: {
        projectId: "prj_1",
        workspaceId,
      },
    });
  });

  it("assignJobToProject sets workspaceId from project", async () => {
    await assignJobToProject(tx as never, {
      jobId: "job_1",
      projectId: "prj_1",
      workspaceId,
    });

    expect(projectFindFirst).toHaveBeenCalledWith({
      where: { id: "prj_1", workspaceId },
      select: { workspaceId: true },
    });
    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "job_1",
        workspaceId,
        OR: [{ projectId: null }, { projectId: "prj_1" }],
      },
      data: {
        projectId: "prj_1",
        workspaceId,
      },
    });
  });

  it("assignTaskToProject throws when project is missing", async () => {
    projectFindFirst.mockResolvedValue(null);

    await expect(
      assignTaskToProject(tx as never, {
        taskId: "tsk_1",
        projectId: "prj_1",
        workspaceId,
      }),
    ).rejects.toThrow(HTTPException);
  });

  it("assignJobToProject throws conflict when update matches no row but job exists", async () => {
    jobUpdateMany.mockResolvedValue({ count: 0 });
    jobFindFirst.mockResolvedValue({ id: "job_1" });

    await expect(
      assignJobToProject(tx as never, {
        jobId: "job_1",
        projectId: "prj_1",
        workspaceId,
      }),
    ).rejects.toThrow(HTTPException);
  });

  it("assignJobToProject throws notFound when update matches no row and job missing", async () => {
    jobUpdateMany.mockResolvedValue({ count: 0 });
    jobFindFirst.mockResolvedValue(null);

    await expect(
      assignJobToProject(tx as never, {
        jobId: "job_1",
        projectId: "prj_1",
        workspaceId,
      }),
    ).rejects.toThrow(HTTPException);
  });
});
