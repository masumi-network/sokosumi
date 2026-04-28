import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assignJobToProject, assignTaskToProject } from "./project-placement";

describe("project-placement", () => {
  const projectFindFirst = vi.fn();
  const taskUpdate = vi.fn();
  const jobUpdate = vi.fn();

  const tx = {
    project: { findFirst: projectFindFirst },
    task: { update: taskUpdate },
    job: { update: jobUpdate },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirst.mockResolvedValue({
      workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });
    taskUpdate.mockResolvedValue(undefined);
    jobUpdate.mockResolvedValue(undefined);
  });

  it("assignTaskToProject sets workspaceId from project", async () => {
    await assignTaskToProject(tx as never, {
      taskId: "tsk_1",
      projectId: "prj_1",
    });

    expect(projectFindFirst).toHaveBeenCalledWith({
      where: { id: "prj_1" },
      select: { workspaceId: true },
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "tsk_1" },
      data: {
        projectId: "prj_1",
        workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      },
    });
  });

  it("assignJobToProject sets workspaceId from project", async () => {
    await assignJobToProject(tx as never, {
      jobId: "job_1",
      projectId: "prj_1",
    });

    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        projectId: "prj_1",
        workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      },
    });
  });

  it("assignTaskToProject throws when project is missing", async () => {
    projectFindFirst.mockResolvedValue(null);

    await expect(
      assignTaskToProject(tx as never, {
        taskId: "tsk_1",
        projectId: "prj_1",
      }),
    ).rejects.toThrow(HTTPException);
  });
});
