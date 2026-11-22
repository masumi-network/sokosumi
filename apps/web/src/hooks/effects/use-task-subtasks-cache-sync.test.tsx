import { TaskStatus } from "@sokosumi/core-client";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SubtaskRow } from "@/app/tasks/utils/task-subtask-row";

import { useTaskSubtasksCacheSync } from "./use-task-subtasks-cache-sync";

function makeRow(id: string): SubtaskRow {
  return {
    id,
    identifier: null,
    name: id,
    status: TaskStatus.READY,
    assignee: null,
    dueOn: null,
    subtaskProgress: { completed: 0, total: 0 },
  };
}

describe("useTaskSubtasksCacheSync", () => {
  it("writes newer server rows into the cache and ignores older rows or in-flight mutations", () => {
    const queryClient = new QueryClient();
    const key = ["task-subtasks", "parent-1"] as const;
    queryClient.setQueryData(key, [makeRow("a")], { updatedAt: 2_000 });

    function Probe({
      rows,
      renderedAt,
    }: {
      rows: SubtaskRow[];
      renderedAt: number;
    }) {
      useTaskSubtasksCacheSync(queryClient, key, rows, renderedAt);
      return null;
    }

    // Older renderedAt does not overwrite newer cache.
    const { rerender, unmount } = render(
      <Probe rows={[makeRow("stale")]} renderedAt={1_000} />,
    );
    expect(queryClient.getQueryData(key)).toEqual([makeRow("a")]);
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(2_000);

    // Newer renderedAt while mutating is skipped.
    const isMutatingSpy = vi
      .spyOn(queryClient, "isMutating")
      .mockReturnValue(1);
    rerender(<Probe rows={[makeRow("blocked")]} renderedAt={3_000} />);
    expect(queryClient.getQueryData(key)).toEqual([makeRow("a")]);

    // Newer renderedAt when idle replaces cache with updatedAt = renderedAt.
    isMutatingSpy.mockReturnValue(0);
    rerender(<Probe rows={[makeRow("fresh")]} renderedAt={4_000} />);
    expect(queryClient.getQueryData(key)).toEqual([makeRow("fresh")]);
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(4_000);

    unmount();
    isMutatingSpy.mockRestore();
  });

  it("matches StrictMode replay and Activity hide/reveal write counts", () => {
    const queryClient = new QueryClient();
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");
    const key = ["task-subtasks", "parent-1"] as const;

    function Probe({
      rows,
      renderedAt,
    }: {
      rows: SubtaskRow[];
      renderedAt: number;
    }) {
      useTaskSubtasksCacheSync(queryClient, key, rows, renderedAt);
      return null;
    }

    const rows1 = [makeRow("a")];
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe rows={rows1} renderedAt={1_000} />
        </Activity>
      </StrictMode>,
    );
    // Run 1 writes updatedAt=1_000; StrictMode replay sees renderedAt > cachedAt is false.
    expect(setQueryDataSpy).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(key)).toEqual(rows1);

    const rows2 = [makeRow("a"), makeRow("b")];
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe rows={rows2} renderedAt={2_000} />
        </Activity>
      </StrictMode>,
    );
    expect(setQueryDataSpy).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe rows={rows2} renderedAt={2_000} />
        </Activity>
      </StrictMode>,
    );
    expect(setQueryDataSpy).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(key)).toEqual(rows2);

    unmount();
    setQueryDataSpy.mockRestore();
  });
});
