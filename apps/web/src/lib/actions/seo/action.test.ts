import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";

import type { SeoCommand } from "./types";

vi.mock("server-only", () => ({}));

const { revalidatePathMock, runNowMock, changeStateMock, requestAnalysisMock } =
  vi.hoisted(() => ({
    revalidatePathMock: vi.fn(),
    runNowMock: vi.fn(),
    requestAnalysisMock: vi.fn(),
    changeStateMock: vi.fn(),
  }));
const deleteAuditMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: object) =>
      await handler({
        ...params,
        session: {
          user: { id: "reader" },
          session: { activeOrganizationId: "team" },
        },
      }),
}));

vi.mock("@/lib/services/task-schedule.service", () => ({
  taskScheduleService: {
    runNow: runNowMock,
    changeScheduleState: changeStateMock,
  },
}));

vi.mock("@/lib/services/seo.service", () => ({
  seoServiceNoRedirect: {
    requestAnalysis: requestAnalysisMock,
    deleteAudit: deleteAuditMock,
  },
}));

import { mutateSeo } from "./action";
import { deleteSeoAuditAction } from "./delete-audit";

const OWNER = {
  kind: "audit",
  id: "01960001-0001-7001-8001-000000000001",
} as const;
const MONITOR_ID = "01960001-0001-7001-8001-000000000042";

it("preserves the Core refusal so the confirmation can explain how to resolve it", async () => {
  deleteAuditMock.mockRejectedValueOnce(
    new CoreApiRequestError("End the schedule first", {
      status: 409,
      kind: "seo_audit_resumable_monitor",
    }),
  );
  expect(await deleteSeoAuditAction({ auditId: OWNER.id })).toMatchObject({
    ok: false,
    error: { status: 409, kind: "seo_audit_resumable_monitor" },
  });
});

it("rejects invalid audit IDs before making a deletion request", async () => {
  deleteAuditMock.mockClear();
  expect(
    await deleteSeoAuditAction({ auditId: "../another-resource" }),
  ).toMatchObject({ ok: false });
  expect(deleteAuditMock).not.toHaveBeenCalled();
});

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

it("refuses the goal selection after an account switch before submitting the analysis", async () => {
  const command = {
    kind: "request_analysis",
    body: { sharedBrief: { revision: 2, pageIds: [MONITOR_ID] } },
  } as SeoCommand;
  const result = await mutateSeo({
    owner: OWNER,
    command,
    briefViewer: { userId: "reader", organizationId: "another team" },
  });
  expect(result).toMatchObject({ ok: false, error: { status: 409 } });
  expect(requestAnalysisMock).not.toHaveBeenCalled();
});
