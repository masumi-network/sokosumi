import type { WorkspaceCalendarItem } from "@sokosumi/core-client";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChangeableRun } from "./run-change";
import { applyRunChange, useRunChanges } from "./use-run-changes";

const { changeRunMock, reportFailureMock } = vi.hoisted(() => ({
  changeRunMock: vi.fn(),
  reportFailureMock: vi.fn(),
}));

vi.mock("./run-change", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-change")>()),
  changeRun: changeRunMock,
  useReportRunChangeFailure: () => reportFailureMock,
}));

const RULE_TIME = new Date("2030-01-02T09:00:00.000Z");

function run(id: string, scheduledAt: Date) {
  return {
    id,
    kind: "RUN",
    scheduledAt,
    originalScheduledAt: RULE_TIME,
  } as WorkspaceCalendarItem;
}

describe("applyRunChange", () => {
  it("puts a restored Run back at the rule's time and leaves the others", () => {
    const moved = run("moved", new Date("2030-01-03T10:30:00.000Z"));
    const other = run("other", new Date("2030-01-05T10:30:00.000Z"));

    const [restored, untouched] = applyRunChange([moved, other], {
      runId: "moved",
      action: "restore",
    });

    expect(restored.scheduledAt).toEqual(RULE_TIME);
    expect(untouched).toBe(other);
  });

  it("takes only the skipped Run away", () => {
    const skipped = run("skipped", RULE_TIME);
    const other = run("other", RULE_TIME);

    expect(
      applyRunChange([skipped, other], { runId: "skipped", action: "skip" }),
    ).toEqual([other]);
  });
});

describe("useRunChanges", () => {
  const READ_REVISION = 3;
  const changeable = (id: string, scheduleRevision = READ_REVISION) =>
    ({
      ...run(id, RULE_TIME),
      scheduleId: "schedule-1",
      scheduleRevision,
    }) as ChangeableRun;
  const sentRevisions = () =>
    changeRunMock.mock.calls.map(([item]) => item.scheduleRevision);
  let answerFirst: (result: unknown) => void;

  beforeEach(() => {
    changeRunMock.mockReset();
    reportFailureMock.mockReset();
    changeRunMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answerFirst = resolve;
      }),
    );
    changeRunMock.mockResolvedValue({ ok: true, value: { revision: 5 } });
  });

  async function skipTwo() {
    const first = changeable("first");
    const second = changeable("second");
    const { result } = renderHook(() => useRunChanges([first, second]));
    await act(async () => {
      result.current[1](first, "skip");
      result.current[1](second, "skip");
    });
    return result;
  }

  it("holds a second change on a schedule and sends it the revision the first one left", async () => {
    const result = await skipTwo();

    expect(result.current[0]).toEqual([]);
    expect(sentRevisions()).toEqual([READ_REVISION]);

    await act(async () => answerFirst({ ok: true, value: { revision: 4 } }));
    expect(sentRevisions()).toEqual([READ_REVISION, 4]);
  });

  it("sends the second change the read revision when Core refused the first", async () => {
    await skipTwo();

    await act(async () =>
      answerFirst({ ok: false, error: { kind: "failed", message: "no" } }),
    );
    expect(reportFailureMock).toHaveBeenCalledWith("failed");
    expect(sentRevisions()).toEqual([READ_REVISION, READ_REVISION]);
  });

  it("sends the newer of the entry's revision and the last one it knows", async () => {
    const result = await skipTwo();
    await act(async () => answerFirst({ ok: true, value: { revision: 4 } }));

    // Fresh entries, read after a change made elsewhere.
    await act(async () => result.current[1](changeable("fresh", 9), "skip"));
    // Entries not yet replaced after the last answer (revision 5).
    await act(async () => result.current[1](changeable("old"), "skip"));

    expect(sentRevisions()).toEqual([READ_REVISION, 4, 9, 5]);
  });

  it("still sends the next change when the failure report of one threw", async () => {
    reportFailureMock.mockImplementation(() => {
      throw new Error("toast failed");
    });
    await skipTwo();

    await act(async () =>
      answerFirst({ ok: false, error: { kind: "failed", message: "no" } }),
    );
    expect(changeRunMock).toHaveBeenCalledTimes(2);
  });
});
