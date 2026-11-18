import { TaskStatus } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SUBTASK_LIST_LIMIT,
  type SubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import { mockCoworkerOption } from "@/test-fixtures/coworker";
import { TaskSubtaskList } from "./task-subtask-list";

const setTaskStatusFromDrag = vi.hoisted(() => vi.fn());
const moveSubtask = vi.hoisted(() => vi.fn());
const createSubtask = vi.hoisted(() => vi.fn());
const getTasks = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "Dec 1" }),
  useNow: () => new Date("2026-11-18T00:00:00.000Z"),
  useTimeZone: () => "UTC",
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) =>
      values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/actions/task/action", () => ({ setTaskStatusFromDrag }));
vi.mock("@/lib/actions/task/subtask-action", () => ({
  createSubtask,
  moveSubtask,
}));
vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTasks },
}));

const member = mockCoworkerOption({
  id: "user-1",
  slug: "bob",
  name: "Bob",
  kind: "user",
});

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
        assigneeOptions={[member]}
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

/** Adds a sub-task through the "+" dialog with only a name. */
function addByDialog(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "add" }));
  fireEvent.change(screen.getByRole("textbox", { name: "name" }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "create" }));
}

/** What Core's list read returns for a sub-task. */
function listItem(
  id: string,
  overrides: { name?: string; status?: TaskStatus } = {},
) {
  return {
    id,
    identifier: null,
    name: overrides.name ?? id,
    status: overrides.status ?? TaskStatus.READY,
    dueOn: null,
    subtaskProgress: { completed: 0, total: 0 },
  };
}

function rowNames() {
  // An open dialog hides the rest of the page from the accessibility tree.
  return screen
    .getAllByRole("listitem", { hidden: true })
    .map((item) => item.textContent?.trim());
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

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

  it("keeps the dialog open with a pending Add until Core answers", async () => {
    const answer = Promise.withResolvers<{ ok: false; error: object }>();
    createSubtask.mockReturnValue(answer.promise);
    renderList([row("a")]);

    addByDialog("b");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "create" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    expect(screen.getByRole("textbox", { name: "name" })).toHaveValue("b");
    expect(rowNames()).toEqual(["a"]);
    await act(async () => answer.resolve({ ok: false, error: {} }));
  });

  it("puts a refused sub-task's name back in the field", async () => {
    createSubtask.mockResolvedValue({
      ok: false,
      error: { code: "UNPROCESSABLE", message: "Too deep." },
    });
    renderList([row("a")]);

    addByDialog("Book the venue");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("createError", {
        description: "Too deep.",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "create" }),
      ).not.toHaveAttribute("aria-busy"),
    );
    expect(screen.getByRole("textbox", { name: "name" })).toHaveValue(
      "Book the venue",
    );
    expect(rowNames()).toEqual(["a"]);
  });

  it("shows Try again later, not the raw text, for a failure that is not Core's refusal", async () => {
    createSubtask.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "fetch failed" },
    });
    renderList([row("a")]);

    addByDialog("Book the venue");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("createError", {
        description: "serverErrorDescription",
      }),
    );
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
    setTaskStatusFromDrag.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderList([row("a")], undefined, 1_000);
    const checkbox = screen.getByRole("checkbox", { name: "toggleLabel a" });
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());

    // Newer than the optimistic write, so only the in-flight check holds it.
    rerender([row("a")], Date.now() + 60_000);
    // TanStack Query renders a cache write on a timer; let one land first.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.getByRole("checkbox", { name: "toggleLabel a" }),
    ).toBeChecked();
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
      screen.queryByRole("button", { name: "add" }),
    ).not.toBeInTheDocument();
  });

  it("sends the name, description, assignee and due date from the + dialog and reads the list again", async () => {
    const user = userEvent.setup();
    createSubtask.mockResolvedValue({ ok: true, value: {} });
    renderList([row("a")]);
    getTasks.mockResolvedValue({
      data: [listItem("a"), listItem("new", { name: "Book it" })],
    });

    await user.click(screen.getByRole("button", { name: "add" }));
    await user.type(screen.getByRole("textbox", { name: "name" }), "Book it");
    await user.type(
      screen.getByRole("textbox", { name: "description" }),
      "  Ask for the corner table.  ",
    );
    await user.click(
      screen.getByRole("combobox", { name: "assignee: unassigned" }),
    );
    await user.click(await screen.findByRole("option", { name: /Bob/ }));
    fireEvent.change(screen.getByLabelText("dueOn"), {
      target: { value: "2026-12-01" },
    });
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() =>
      expect(createSubtask).toHaveBeenCalledWith({
        parentTaskId: "parent",
        name: "Book it",
        description: "Ask for the corner table.",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: "user-1",
        dueOn: "2026-12-01",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "name" })).toBeNull(),
    );
    await waitFor(() => expect(rowNames()).toEqual(["a", "Book it"]));
  });

  it("reads the list again after a + add, so the new row shows when the cache is stamped after the page", async () => {
    createSubtask.mockResolvedValue({ ok: true, value: {} });
    const { rerender } = renderList([row("a")], undefined, 1_000);
    // A toggle that settled: its read stamps the cache with the client clock.
    getTasks.mockResolvedValue({
      data: [listItem("a", { status: TaskStatus.COMPLETED })],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "toggleLabel a" }));
    await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "toggleLabel a" }),
      ).toBeChecked(),
    );

    getTasks.mockResolvedValue({
      data: [
        listItem("a", { status: TaskStatus.COMPLETED }),
        listItem("new", { name: "Book it" }),
      ],
    });
    addByDialog("Book it");
    // The server's clock is behind that stamp, so the page rows do not apply.
    rerender(
      [
        row("a", { status: TaskStatus.COMPLETED }),
        row("new", { name: "Book it" }),
      ],
      2_000,
    );

    await waitFor(() => expect(rowNames()).toEqual(["a", "Book it"]));
  });

  it("does not read the list again after a + add while a toggle is in flight", async () => {
    const toggle = Promise.withResolvers<{ ok: true }>();
    setTaskStatusFromDrag.mockReturnValue(toggle.promise);
    createSubtask.mockResolvedValue({ ok: true, value: {} });
    renderList([row("a")]);
    const checkbox = screen.getByRole("checkbox", { name: "toggleLabel a" });
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());

    addByDialog("Book it");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("createSuccess"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "name" })).toBeNull(),
    );

    // A read now could land before the toggle and undo it on screen.
    expect(getTasks).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "toggleLabel a" }),
    ).toBeChecked();
    await act(async () => toggle.resolve({ ok: true }));
  });

  it("labels the assignee picker in the + dialog", () => {
    renderList([row("a")]);

    fireEvent.click(screen.getByRole("button", { name: "add" }));

    expect(screen.getByLabelText("assignee")).toHaveAttribute(
      "role",
      "combobox",
    );
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
