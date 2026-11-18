import { TaskStatus } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubtaskRow } from "@/app/tasks/utils/task-subtask-row";
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

function renderList(rows: SubtaskRow[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // The refetch after a change answers with what the server would hold.
  getTasks.mockImplementation(async () => ({ data: [] }));
  render(
    <QueryClientProvider client={queryClient}>
      <TaskSubtaskList
        parentTaskId="parent"
        initialRows={rows}
        readOnly={false}
      />
    </QueryClientProvider>,
  );
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
