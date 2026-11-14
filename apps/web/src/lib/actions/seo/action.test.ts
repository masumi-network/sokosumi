import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeoCommand } from "./types";

vi.mock("server-only", () => ({}));

const { revalidatePathMock, runNowMock, changeStateMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  runNowMock: vi.fn(),
  changeStateMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    runNow: runNowMock,
    changeScheduleState: changeStateMock,
  },
}));

vi.mock("@/lib/services/seo.service", () => ({ seoServiceNoRedirect: {} }));

import { mutateSeo } from "./action";

const OWNER = {
  kind: "audit",
  id: "01960001-0001-7001-8001-000000000001",
} as const;
const MONITOR_ID = "01960001-0001-7001-8001-000000000042";

function mutate(command: unknown) {
  return mutateSeo({ owner: OWNER, command: command as SeoCommand });
}

describe("mutateSeo monitor commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a valid monitor command to Core", async () => {
    runNowMock.mockResolvedValue({});

    const result = await mutate({
      kind: "monitor_run_now",
      monitorId: MONITOR_ID,
      expectedRevision: 3,
    });

    expect(result).toEqual({ ok: true, value: null });
    expect(runNowMock).toHaveBeenCalledWith(MONITOR_ID, {
      expectedRevision: 3,
    });
  });

  it.each([
    ["an id that is not a UUID", { monitorId: "../task-schedules" }],
    ["an unknown state action", { action: "delete" }],
    ["an extra field", { ownerId: MONITOR_ID }],
  ])("refuses %s before it reaches Core", async (_, change) => {
    const result = await mutate({
      kind: "monitor_state",
      monitorId: MONITOR_ID,
      action: "pause",
      ...change,
    });

    expect(result).toMatchObject({ ok: false });
    expect(changeStateMock).not.toHaveBeenCalled();
  });
});
