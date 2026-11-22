import type { GetTasksResponse } from "@sokosumi/core-client";
import { act, render, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTasksMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTasks: getTasksMock },
}));

import { useTaskLinkPickerTasks } from "./use-task-link-picker-tasks";

function makeResponse(
  ids: string[],
  nextCursor: string | null = null,
): GetTasksResponse {
  return {
    data: ids.map((id) => ({
      id,
      name: `Task ${id}`,
      status: "READY",
    })),
    meta: { pagination: { nextCursor } },
  } as unknown as GetTasksResponse;
}

const translate = (key: string) => key;

describe("useTaskLinkPickerTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads filtered tasks, supports pagination, and drops stale responses on query change", async () => {
    const first = Promise.withResolvers<GetTasksResponse>();
    const second = Promise.withResolvers<GetTasksResponse>();
    getTasksMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(makeResponse(["t4"], null));

    const captured: {
      latest: ReturnType<typeof useTaskLinkPickerTasks> | null;
    } = { latest: null };

    function Probe({
      debouncedQuery,
      includeSubtasks = false,
    }: {
      debouncedQuery: string;
      includeSubtasks?: boolean;
    }) {
      captured.latest = useTaskLinkPickerTasks({
        taskId: "self",
        debouncedQuery,
        includeSubtasks,
        excludeTaskIds: ["excluded"],
        tDetailActions: translate,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <Probe debouncedQuery="" includeSubtasks />,
    );
    expect(getTasksMock).toHaveBeenCalledWith({
      q: undefined,
      cursor: undefined,
      limit: 20,
      includeSubtasks: "true",
    });
    expect(captured.latest?.isLoading).toBe(true);

    rerender(<Probe debouncedQuery="alpha" includeSubtasks />);
    expect(getTasksMock).toHaveBeenCalledWith({
      q: "alpha",
      cursor: undefined,
      limit: 20,
      includeSubtasks: "true",
    });

    // Stale response from the earlier query must be ignored.
    await act(async () => {
      first.resolve(makeResponse(["stale"]));
      await first.promise;
    });
    expect(captured.latest?.results).toEqual([]);
    expect(captured.latest?.isLoading).toBe(true);

    await act(async () => {
      second.resolve(
        makeResponse(["self", "excluded", "t1", "t2"], "cursor-2"),
      );
      await second.promise;
    });
    expect(captured.latest?.results.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(captured.latest?.nextCursor).toBe("cursor-2");
    expect(captured.latest?.isLoading).toBe(false);

    await act(async () => {
      captured.latest?.loadMore();
    });
    await waitFor(() =>
      expect(captured.latest?.results.map((t) => t.id)).toEqual([
        "t1",
        "t2",
        "t4",
      ]),
    );
    expect(captured.latest?.nextCursor).toBeNull();
    expect(getTasksMock).toHaveBeenLastCalledWith({
      q: "alpha",
      cursor: "cursor-2",
      limit: 20,
      includeSubtasks: "true",
    });

    unmount();
  });

  it("reports initial and load-more errors while preserving loaded rows on load-more failure", async () => {
    getTasksMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeResponse(["t1"], "cursor-2"))
      .mockRejectedValueOnce(new Error("page 2 failed"));

    const captured: {
      latest: ReturnType<typeof useTaskLinkPickerTasks> | null;
    } = { latest: null };

    function Probe({ debouncedQuery }: { debouncedQuery: string }) {
      captured.latest = useTaskLinkPickerTasks({
        taskId: "self",
        debouncedQuery,
        includeSubtasks: false,
        excludeTaskIds: [],
        tDetailActions: translate,
      });
      return null;
    }

    const { rerender, unmount } = render(<Probe debouncedQuery="" />);
    await waitFor(() => expect(captured.latest?.error).toBe("taskPickerError"));
    expect(captured.latest?.results).toEqual([]);
    expect(captured.latest?.nextCursor).toBeNull();

    rerender(<Probe debouncedQuery="ok" />);
    await waitFor(() =>
      expect(captured.latest?.results.map((t) => t.id)).toEqual(["t1"]),
    );
    expect(captured.latest?.error).toBeNull();

    await act(async () => {
      captured.latest?.loadMore();
    });
    await waitFor(() =>
      expect(captured.latest?.error).toBe("taskPickerLoadMoreError"),
    );
    expect(captured.latest?.results.map((t) => t.id)).toEqual(["t1"]);

    unmount();
  });

  it("matches StrictMode replay, Activity hide/reveal, and settles cleanly after unmount", async () => {
    const r1 = Promise.withResolvers<GetTasksResponse>();
    const r2 = Promise.withResolvers<GetTasksResponse>();
    const r3 = Promise.withResolvers<GetTasksResponse>();
    const r4 = Promise.withResolvers<GetTasksResponse>();
    getTasksMock
      .mockReturnValueOnce(r1.promise)
      .mockReturnValueOnce(r2.promise)
      .mockReturnValueOnce(r3.promise)
      .mockReturnValueOnce(r4.promise);

    const captured: {
      latest: ReturnType<typeof useTaskLinkPickerTasks> | null;
    } = { latest: null };

    function Probe() {
      captured.latest = useTaskLinkPickerTasks({
        taskId: "self",
        debouncedQuery: "",
        includeSubtasks: false,
        excludeTaskIds: [],
        tDetailActions: translate,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    // StrictMode mount runs the effect twice; only the latest requestId commits.
    expect(getTasksMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      r1.resolve(makeResponse(["stale-strict"]));
      await r1.promise;
    });
    expect(captured.latest?.results).toEqual([]);

    await act(async () => {
      r2.resolve(makeResponse(["fresh-strict"]));
      await r2.promise;
    });
    expect(captured.latest?.results.map((t) => t.id)).toEqual(["fresh-strict"]);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(getTasksMock).toHaveBeenCalledTimes(2);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(getTasksMock).toHaveBeenCalledTimes(4);

    // Unmount while r3 and r4 are still pending: settling them afterward must not throw or re-fetch.
    unmount();
    await act(async () => {
      r3.resolve(makeResponse(["after-unmount-3"]));
      r4.resolve(makeResponse(["after-unmount-4"]));
      await Promise.all([r3.promise, r4.promise]);
    });
    expect(getTasksMock).toHaveBeenCalledTimes(4);
  });
});
