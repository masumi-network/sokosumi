import { TaskStatus } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SUBTASK_LIST_LIMIT,
  type SubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import { TaskSubtaskList } from "./task-subtask-list";

const setTaskStatusFromDrag = vi.hoisted(() => vi.fn());
const moveSubtask = vi.hoisted(() => vi.fn());
const createSubtask = vi.hoisted(() => vi.fn());
const getTasks = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) =>
      values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/actions/task/action", () => ({ setTaskStatusFromDrag }));
vi.mock("@/lib/actions/task/subtask-action", () => ({
  createSubtask,
  moveSubtask,
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTasks },
}));

function row(id: string, overrides: Partial<SubtaskRow> = {}): SubtaskRow {
  return {
    id,
    identifier: null,
    name: id,
    status: TaskStatus.READY,
    assignee: null,
    dueOn: null,
    subtaskProgress: { completed: 0, total: 0 },
    ...overrides,
  };
}

function renderList(
  rows: SubtaskRow[],
  progress = { completed: 0, total: rows.length },
  renderedAt = 1_000,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // The refetch after a change answers with what the server would hold.
  getTasks.mockImplementation(async () => ({ data: [] }));
  const list = (initialRows: SubtaskRow[], at: number) => (
    <QueryClientProvider client={queryClient}>
      <TaskSubtaskList
        parentTaskId="parent"
        initialRows={initialRows}
        renderedAt={at}
        readOnly={false}
        canAdd
        progress={progress}
      />
    </QueryClientProvider>
  );
  const { rerender, unmount } = render(list(rows, renderedAt));
  return {
    // A refresh: the same list gets the page's new rows.
    rerender: (next: SubtaskRow[], at: number) => rerender(list(next, at)),
    // Back: a new list over the same cache, with a replayed page payload.
    remount: (next: SubtaskRow[], at: number) => {
      unmount();
      render(list(next, at));
    },
  };
}

function rowNames() {
  return screen
    .getAllByRole("listitem")
    .map((item) => item.textContent?.trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  setTaskStatusFromDrag.mockResolvedValue({ ok: true });
  moveSubtask.mockResolvedValue({ ok: true });
});

describe("TaskSubtaskList", () => {
  it("moves a row down with Arrow Down on its handle and names the new place", async () => {
    // Hold the refetch so the order under test is the optimistic one.
    renderList([row("a"), row("b"), row("c")]);
    getTasks.mockImplementation(() => new Promise(() => {}));

    fireEvent.keyDown(screen.getByRole("button", { name: "reorderHandle a" }), {
      key: "ArrowDown",
    });

    await waitFor(() => expect(rowNames()).toEqual(["b", "a", "c"]));
    expect(screen.getByText("movedTo 2 3")).toBeInTheDocument();
    await waitFor(() =>
      expect(moveSubtask).toHaveBeenCalledWith({
        taskId: "a",
        afterTaskId: "b",
      }),
    );
  });

  it("moves a row to the top with Alt+Arrow Up anywhere in the row", async () => {
    renderList([row("a"), row("b")]);
    getTasks.mockImplementation(() => new Promise(() => {}));

    fireEvent.keyDown(screen.getByRole("checkbox", { name: "toggleLabel b" }), {
      key: "ArrowUp",
      altKey: true,
    });

    await waitFor(() => expect(rowNames()).toEqual(["b", "a"]));
    await waitFor(() =>
      expect(moveSubtask).toHaveBeenCalledWith({
        taskId: "b",
        afterTaskId: null,
      }),
    );
  });

  it("puts the order back when Core refuses the move", async () => {
    moveSubtask.mockResolvedValue({ ok: false });
    renderList([row("a"), row("b")]);
    getTasks.mockImplementation(() => new Promise(() => {}));

    fireEvent.keyDown(screen.getByRole("button", { name: "reorderHandle a" }), {
      key: "ArrowDown",
    });

    await waitFor(() => expect(moveSubtask).toHaveBeenCalled());
    await waitFor(() => expect(rowNames()).toEqual(["a", "b"]));
  });

  it("does not move a row past a sub-task Core has not created yet", async () => {
    createSubtask.mockImplementation(() => new Promise(() => {}));
    renderList([row("a")]);

    const input = screen.getByRole("textbox", { name: "add" });
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.submit(input);
    await waitFor(() => expect(rowNames()).toEqual(["a", "b"]));
    fireEvent.keyDown(screen.getByRole("button", { name: "reorderHandle a" }), {
      key: "ArrowDown",
    });

    // The announcement is set in the same tick as a move would start.
    expect(screen.queryByText(/^movedTo/)).not.toBeInTheDocument();
    expect(rowNames()).toEqual(["a", "b"]);
    expect(moveSubtask).not.toHaveBeenCalled();
  });

  it("puts a refused sub-task's name back in the field", async () => {
    createSubtask.mockResolvedValue({ ok: false });
    renderList([]);
    getTasks.mockImplementation(() => new Promise(() => {}));

    const input = screen.getByRole("textbox", { name: "add" });
    fireEvent.change(input, { target: { value: "Book the venue" } });
    fireEvent.submit(input);

    await waitFor(() => expect(input).toHaveValue("Book the venue"));
  });

  it("takes newer page rows after a refresh", async () => {
    const { rerender } = renderList([row("a")], undefined, 1_000);

    rerender([row("a", { status: TaskStatus.COMPLETED }), row("b")], 2_000);

    await waitFor(() => expect(rowNames()).toEqual(["a", "b"]));
    expect(
      screen.getByRole("checkbox", { name: "toggleLabel a" }),
    ).toBeChecked();
  });

  it("keeps a change in flight over newer page rows", async () => {
    createSubtask.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderList([row("a")], undefined, 1_000);
    const input = screen.getByRole("textbox", { name: "add" });
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.submit(input);
    await waitFor(() => expect(rowNames()).toEqual(["a", "b"]));

    // Newer than the optimistic write, so only the in-flight check holds it.
    rerender([row("a")], Date.now() + 60_000);
    // TanStack Query renders a cache write on a timer; let one land first.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rowNames()).toEqual(["a", "b"]);
  });

  it("keeps the cache over older page rows that Back replays", async () => {
    const { remount } = renderList([row("a"), row("b")], undefined, 2_000);

    remount([row("a")], 1_000);
    // TanStack Query renders a cache write on a timer; let one land first.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rowNames()).toEqual(["a", "b"]);
  });

  it("keeps its own count at exactly the first page", () => {
    renderList(
      Array.from({ length: SUBTASK_LIST_LIMIT }, (_, index) =>
        row(`r${index}`, {
          status: index === 0 ? TaskStatus.COMPLETED : TaskStatus.READY,
        }),
      ),
      { completed: 0, total: SUBTASK_LIST_LIMIT },
    );

    expect(
      screen.getByText(`progressLabel 1 ${SUBTASK_LIST_LIMIT}`),
    ).toBeInTheDocument();
  });

  it("counts every sub-task and offers no add past the first page", () => {
    renderList(
      Array.from({ length: SUBTASK_LIST_LIMIT }, (_, index) =>
        row(`r${index}`),
      ),
      { completed: 7, total: 140 },
    );

    expect(screen.getByText("progressLabel 7 140")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "add" }),
    ).not.toBeInTheDocument();
  });

  it("reopens a person's done sub-task to Ready without asking", async () => {
    renderList([row("a", { status: TaskStatus.COMPLETED })]);

    fireEvent.click(screen.getByRole("checkbox", { name: "toggleLabel a" }));

    await waitFor(() =>
      expect(setTaskStatusFromDrag).toHaveBeenCalledWith({
        taskId: "a",
        desiredStatus: TaskStatus.READY,
      }),
    );
  });

  it("asks before a Coworker's done sub-task goes back, and can park it as a Draft", async () => {
    renderList([
      row("a", {
        status: TaskStatus.COMPLETED,
        assignee: { id: "cw", name: "Writer", kind: "coworker" },
      }),
    ]);

    fireEvent.click(screen.getByRole("checkbox", { name: "toggleLabel a" }));
    expect(setTaskStatusFromDrag).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "reopenAsDraft" }),
    );

    await waitFor(() =>
      expect(setTaskStatusFromDrag).toHaveBeenCalledWith({
        taskId: "a",
        desiredStatus: TaskStatus.DRAFT,
      }),
    );
  });
});
