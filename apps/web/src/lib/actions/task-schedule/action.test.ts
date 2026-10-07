import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";

vi.mock("server-only", () => ({}));

const { revalidatePathMock, runNowMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  runNowMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: { runNow: runNowMock },
}));

import { runTaskScheduleNow } from "./action";

const SCHEDULE_ID = "01960001-0001-7001-8001-000000000042";

function run(scheduleId = SCHEDULE_ID) {
  return runTaskScheduleNow({ scheduleId, expectedRevision: 3 });
}

describe("runTaskScheduleNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new Task and refreshes the schedule pages", async () => {
    runNowMock.mockResolvedValue({
      revision: 4,
      run: { releasedTaskId: "task_now" },
    });

    const result = await run();

    expect(runNowMock).toHaveBeenCalledWith(SCHEDULE_ID, {
      expectedRevision: 3,
    });
    expect(result).toEqual({
      ok: true,
      value: { scheduleId: SCHEDULE_ID, taskId: "task_now" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/schedules/${SCHEDULE_ID}`,
    );
  });

  it("reports a stale revision so the caller reloads", async () => {
    runNowMock.mockRejectedValue(
      new CoreApiRequestError("Task Schedule changed since it was read", {
        status: 409,
        kind: CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
      }),
    );

    const result = await run();

    expect(result).toMatchObject({ ok: false, error: { kind: "stale" } });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("fails when Core reports no Task for the Run", async () => {
    runNowMock.mockResolvedValue({
      revision: 4,
      run: { releasedTaskId: null },
    });

    const result = await run();

    expect(result).toMatchObject({ ok: false, error: { kind: "failed" } });
  });
});
