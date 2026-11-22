import type { TaskSchedule } from "@sokosumi/core-client";
import { act, render, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadMoreTaskSchedulesMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/tasks/actions", () => ({
  loadMoreTaskSchedules: loadMoreTaskSchedulesMock,
}));

import { useTaskSchedulesPagination } from "./use-task-schedules-pagination";

function makeSchedule(id: string): TaskSchedule {
  return {
    id,
    creator: null,
    workspaceId: "11111111-1111-7111-8111-111111111111",
    organizationId: null,
    ownerId: "user_1",
    creatorUserId: "user_1",
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    state: "ACTIVE",
    rule: {
      expr: "0 9 * * MON",
      timezone: "UTC",
      intervalDays: null,
      anchorAt: new Date("2030-01-07T09:00:00.000Z"),
      endsMode: "NEVER",
      endsOn: null,
      targetRunCount: null,
    },
    ruleEffectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
    releasedCount: 0,
    nextRunAt: new Date("2030-01-07T09:00:00.000Z"),
    revision: 0,
    name: `Schedule ${id}`,
    description: null,
    projectId: null,
    visibility: "PUBLIC",
    assigneeId: null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    canWrite: true,
    canRunNow: true,
    canEditPlan: true,
  };
}

describe("useTaskSchedulesPagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-pages while searching, stops when searching turns false between pages, and drops stale pages after handleScheduleChanged", async () => {
    const page1 = Promise.withResolvers<{
      schedules: TaskSchedule[];
      nextCursor: string | null;
    }>();
    const page2 = Promise.withResolvers<{
      schedules: TaskSchedule[];
      nextCursor: string | null;
    }>();
    loadMoreTaskSchedulesMock
      .mockReturnValueOnce(page1.promise)
      .mockReturnValueOnce(page2.promise);

    const router = { refresh: vi.fn() };
    const captured: {
      latest: ReturnType<typeof useTaskSchedulesPagination> | null;
    } = { latest: null };

    function Probe({
      searching,
      nextCursor,
    }: {
      searching: boolean;
      nextCursor: string | null;
    }) {
      captured.latest = useTaskSchedulesPagination({
        schedules: [makeSchedule("s1")],
        nextCursor,
        selectedProjectId: "proj-1",
        selectedState: "ACTIVE",
        searching,
        router,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <Probe searching={false} nextCursor="c1" />,
    );
    expect(loadMoreTaskSchedulesMock).not.toHaveBeenCalled();

    // Turning searching on requests page 1.
    rerender(<Probe searching={true} nextCursor="c1" />);
    await waitFor(() =>
      expect(loadMoreTaskSchedulesMock).toHaveBeenCalledTimes(1),
    );
    expect(loadMoreTaskSchedulesMock).toHaveBeenLastCalledWith({
      cursor: "c1",
      projectId: "proj-1",
      state: "ACTIVE",
    });

    // Resolve page 1 while still searching -> automatically requests page 2 (c2).
    await act(async () => {
      page1.resolve({
        schedules: [makeSchedule("s1"), makeSchedule("s2")],
        nextCursor: "c2",
      });
      await page1.promise;
    });
    await waitFor(() =>
      expect(loadMoreTaskSchedulesMock).toHaveBeenCalledTimes(2),
    );
    expect(captured.latest?.loaded.map((s) => s.id)).toEqual(["s1", "s2"]);

    // Turn searching off and trigger handleScheduleChanged while page 2 is in flight.
    rerender(<Probe searching={false} nextCursor="c1" />);
    act(() => {
      captured.latest?.handleScheduleChanged();
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // Resolving stale page 2 must be discarded because generation bumped.
    await act(async () => {
      page2.resolve({
        schedules: [makeSchedule("stale-s3")],
        nextCursor: "c3",
      });
      await page2.promise;
    });
    expect(captured.latest?.loaded.map((s) => s.id)).toEqual(["s1"]);
    expect(loadMoreTaskSchedulesMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("matches StrictMode replay, Activity hide/reveal, and settles cleanly after unmount while pending", async () => {
    const r1 = Promise.withResolvers<{
      schedules: TaskSchedule[];
      nextCursor: string | null;
    }>();
    const r2 = Promise.withResolvers<{
      schedules: TaskSchedule[];
      nextCursor: string | null;
    }>();
    const r3 = Promise.withResolvers<{
      schedules: TaskSchedule[];
      nextCursor: string | null;
    }>();
    loadMoreTaskSchedulesMock
      .mockReturnValueOnce(r1.promise)
      .mockReturnValueOnce(r2.promise)
      .mockReturnValueOnce(r3.promise);

    const router = { refresh: vi.fn() };
    const captured: {
      latest: ReturnType<typeof useTaskSchedulesPagination> | null;
    } = { latest: null };

    function Probe({ searching }: { searching: boolean }) {
      captured.latest = useTaskSchedulesPagination({
        schedules: [makeSchedule("s1")],
        nextCursor: "c1",
        selectedProjectId: null,
        selectedState: null,
        searching,
        router,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe searching={true} />
        </Activity>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(loadMoreTaskSchedulesMock).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      r1.resolve({ schedules: [makeSchedule("s2")], nextCursor: "c2" });
      r2.resolve({ schedules: [makeSchedule("s3")], nextCursor: null });
      await Promise.all([r1.promise, r2.promise]);
    });
    await waitFor(() => expect(captured.latest?.nextCursor).toBeNull());

    // Reset with handleScheduleChanged, hide, then reveal -> starts r3.
    act(() => {
      captured.latest?.handleScheduleChanged();
    });
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe searching={true} />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe searching={true} />
        </Activity>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(loadMoreTaskSchedulesMock).toHaveBeenCalledTimes(3),
    );
    await act(async () => {
      r3.resolve({
        schedules: [makeSchedule("after-reveal")],
        nextCursor: null,
      });
      await r3.promise;
    });
    await waitFor(() =>
      expect(captured.latest?.loaded.map((s) => s.id)).toEqual([
        "s1",
        "after-reveal",
      ]),
    );
    unmount();
  });

  it("settles cleanly when unmounted while a page request is pending", async () => {
    const pending = Promise.withResolvers<{
      schedules: TaskSchedule[];
      nextCursor: string | null;
    }>();
    loadMoreTaskSchedulesMock.mockReturnValueOnce(pending.promise);
    const router = { refresh: vi.fn() };

    function Probe() {
      useTaskSchedulesPagination({
        schedules: [makeSchedule("s1")],
        nextCursor: "c1",
        selectedProjectId: null,
        selectedState: null,
        searching: true,
        router,
      });
      return null;
    }

    const { unmount } = render(<Probe />);
    await waitFor(() =>
      expect(loadMoreTaskSchedulesMock).toHaveBeenCalledTimes(1),
    );

    unmount();
    await act(async () => {
      pending.resolve({
        schedules: [makeSchedule("after-unmount")],
        nextCursor: "c2",
      });
      await pending.promise;
    });
    expect(loadMoreTaskSchedulesMock).toHaveBeenCalledTimes(1);
  });
});
