import { describe, expect, it, vi } from "vitest";
import {
  sokoBotProjectRefusal,
  sokoBotWriteScopeRefusal,
} from "@/lib/soko-bot/write-scope";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const PROJECT = "01960001-0001-7001-8001-0000000000a1";
const OTHER = "01960001-0001-7001-8001-0000000000a2";
const PROJECT_SCOPE = {
  sokoBotId: "bot_1",
  workspaceId: "ws_1",
  projectId: PROJECT,
};
const WORKSPACE_SCOPE = { ...PROJECT_SCOPE, projectId: null };

function client(tasks: number, jobs: number) {
  return {
    task: { count: vi.fn().mockResolvedValue(tasks) },
    job: { count: vi.fn().mockResolvedValue(jobs) },
  };
}

describe("sokoBotProjectRefusal", () => {
  it("keeps a project bot in its own Project", () => {
    expect(sokoBotProjectRefusal(PROJECT_SCOPE, [PROJECT])).toBeNull();
    expect(sokoBotProjectRefusal(PROJECT_SCOPE, [OTHER])).toContain(
      "only in its own Project",
    );
    expect(sokoBotProjectRefusal(PROJECT_SCOPE, [null])).not.toBeNull();
  });

  it("leaves a workspace or personal bot free to pick a Project", () => {
    expect(sokoBotProjectRefusal(WORKSPACE_SCOPE, [OTHER, null])).toBeNull();
    expect(sokoBotProjectRefusal(null, [OTHER])).toBeNull();
  });
});

describe("sokoBotWriteScopeRefusal", () => {
  it("costs a personal bot no query", async () => {
    const db = client(0, 0);
    await expect(
      sokoBotWriteScopeRefusal(db as never, null, {
        taskIds: ["t1"],
        jobId: "j1",
      }),
    ).resolves.toBeNull();
    expect(db.task.count).not.toHaveBeenCalled();
    expect(db.job.count).not.toHaveBeenCalled();
  });

  it("refuses a Task the scope does not show", async () => {
    const db = client(1, 0);
    await expect(
      sokoBotWriteScopeRefusal(db as never, WORKSPACE_SCOPE, {
        taskIds: ["t1", "t2", "t1", undefined],
      }),
    ).resolves.toBe("Task not found");
    expect(db.task.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: { in: ["t1", "t2"] } },
          { workspaceId: "ws_1", visibility: "PUBLIC" },
        ],
      },
    });
  });

  it("allows Tasks and a Job inside the scope", async () => {
    await expect(
      sokoBotWriteScopeRefusal(client(1, 1) as never, PROJECT_SCOPE, {
        taskIds: ["t1"],
        projectIds: [PROJECT],
        jobId: "j1",
      }),
    ).resolves.toBeNull();
  });

  it("refuses a Job the scope does not show", async () => {
    await expect(
      sokoBotWriteScopeRefusal(client(0, 0) as never, PROJECT_SCOPE, {
        jobId: "j1",
      }),
    ).resolves.toBe("Job not found");
  });
});
