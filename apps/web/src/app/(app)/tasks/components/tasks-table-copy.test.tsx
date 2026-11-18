import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { TasksTableCopy } from "./tasks-table-copy";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  batch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { create: m.create, batch: m.batch },
}));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));

const tasks = Array.from(
  { length: 3 },
  (_, i) =>
    ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      identifier: null,
      name: `Task ${i}`,
      status: "READY",
    }) as TaskWithCoworker,
);

function view(props: {
  notLoaded: number | "unknown" | 0;
  shown?: TaskWithCoworker[];
  workspace?: string;
}) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="UTC"
      formats={createFormats()}
    >
      <TasksTableCopy
        tasks={props.shown ?? tasks}
        notLoaded={props.notLoaded}
        projectId={null}
        statusLabels={{ READY: "To do" } as never}
        workspace={props.workspace ?? "org-a"}
      />
    </NextIntlClientProvider>
  );
}

function show(props: Parameters<typeof view>[0]) {
  const { rerender } = render(view(props));
  return (next: Parameters<typeof view>[0]) => rerender(view(next));
}

const openDialog = () =>
  userEvent.click(screen.getByRole("button", { name: "Copy to table" }));

beforeEach(() => {
  vi.clearAllMocks();
  m.create.mockResolvedValue({ id: "table-1" });
  m.batch.mockResolvedValue({});
});

describe("TasksTableCopy", () => {
  it("says how many Tasks it copies and that unloaded ones stay out, before copying", async () => {
    show({ notLoaded: 4 });
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to table" }),
    );

    expect(
      screen.getByText(/3 Tasks on the board go into a new table in Files/),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /3 Tasks on the board go into a new table.*4 more Tasks match your filters but aren't loaded/,
    );
    expect(m.create).not.toHaveBeenCalled();
  });

  it("warns without a number when the list cannot count what is not loaded", async () => {
    show({ notLoaded: "unknown" });
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to table" }),
    );
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /3 Tasks on the board go into a new table.*More Tasks match your filters than are loaded/,
    );
  });

  it("copies the Tasks into a new Table and offers to open it", async () => {
    show({ notLoaded: 0 });
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to table" }),
    );
    expect(screen.queryByText(/match your filters/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));

    await waitFor(() =>
      expect(m.success).toHaveBeenCalledWith(
        "3 Tasks copied to a new table.",
        expect.anything(),
      ),
    );
    expect(m.create.mock.calls[0][0].title).toMatch(/^Tasks · /);
    expect(m.batch.mock.calls[0][1].insert).toHaveLength(3);
    m.success.mock.calls[0][1].action.onClick();
    expect(m.push).toHaveBeenCalledWith("/drive/tables/table-1");
  });

  it("finishes a failed copy in the same Table on the next press", async () => {
    m.batch.mockRejectedValueOnce(new Error("offline"));
    show({ notLoaded: 0 });
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to table" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
    await waitFor(() => expect(m.error).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: "Finish copy" }));
    await waitFor(() => expect(m.success).toHaveBeenCalled());
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.batch.mock.calls[1][1].key).toBe(m.batch.mock.calls[0][1].key);
  });

  it("cannot copy when no Task is on the board", async () => {
    show({ notLoaded: 0, shown: [] });
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to table" }),
    );
    expect(screen.getByRole("button", { name: "Copy 0 Tasks" })).toBeDisabled();
  });
  it("leaves private Tasks out of the shared table and says so", async () => {
    show({
      notLoaded: 0,
      shown: [...tasks, { ...tasks[0], id: "p1", visibility: "PRIVATE" }],
    });
    await openDialog();
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /3 Tasks on the board go into a new table.*1 private Task stays out/,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
    await waitFor(() => expect(m.success).toHaveBeenCalled());
    expect(m.batch.mock.calls[0][1].insert).toHaveLength(3);
  });

  it("copies nothing when every Task on the board is private", async () => {
    show({
      notLoaded: 0,
      shown: [{ ...tasks[0], visibility: "PRIVATE" }],
    });
    await openDialog();
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /1 private Task stays out/,
    );
    expect(screen.getByRole("button", { name: "Copy 0 Tasks" })).toBeDisabled();
  });

  it("after a failure, offers to finish the saved copy even when the board has changed", async () => {
    m.batch.mockRejectedValueOnce(new Error("offline"));
    const update = show({ notLoaded: 0 });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
    await waitFor(() => expect(m.error).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // The filters changed: nothing matches now.
    update({ notLoaded: 0, shown: [] });
    await openDialog();
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /The last copy stopped before it finished\. It copies the 3 Tasks you confirmed then into .Tasks · .*, not the Tasks on the board now\./,
    );
    await userEvent.click(screen.getByRole("button", { name: "Finish copy" }));
    await waitFor(() => expect(m.success).toHaveBeenCalled());
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.batch.mock.calls[1][1].insert).toHaveLength(3);

    // Done: the next copy is a new one, of the board as it is.
    await openDialog();
    expect(screen.getByRole("button", { name: "Copy 0 Tasks" })).toBeDisabled();
  });
  it("binds every write to the workspace the copy was confirmed in", async () => {
    show({ notLoaded: 0 });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
    await waitFor(() => expect(m.success).toHaveBeenCalled());
    expect(m.create.mock.calls[0][1]).toBe("org-a");
    expect(m.batch.mock.calls[0][2]).toBe("org-a");
  });

  it("drops a failed copy when the workspace changes, and copies afresh there", async () => {
    m.create.mockRejectedValueOnce(new Error("offline"));
    const update = show({ notLoaded: 0 });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
    await waitFor(() => expect(m.error).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    update({ notLoaded: 0, shown: [tasks[0]], workspace: "org-b" });
    await openDialog();
    expect(screen.queryByText(/The last copy stopped/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy 1 Task" }));
    await waitFor(() => expect(m.success).toHaveBeenCalled());
    expect(m.create.mock.calls[1][1]).toBe("org-b");
    expect(m.create.mock.calls[1][0].key).not.toBe(
      m.create.mock.calls[0][0].key,
    );
    expect(m.batch.mock.calls[0][1].insert).toHaveLength(1);
  });

  it("keeps a request that returns after a switch bound to the old workspace, and reports nothing in the new one", async () => {
    const created = Promise.withResolvers<{ id: string }>();
    m.create.mockReturnValueOnce(created.promise);
    // Core refuses the write: the session's workspace is no longer the confirmed one.
    m.batch.mockRejectedValueOnce(
      new Error("409 The active workspace changed"),
    );
    const update = show({ notLoaded: 0 });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));

    update({ notLoaded: 0, workspace: "org-b" });
    await act(async () => created.resolve({ id: "table-1" }));
    await waitFor(() => expect(m.batch).toHaveBeenCalled());
    expect(m.batch.mock.calls[0][2]).toBe("org-a");
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(m.error).not.toHaveBeenCalled();
    expect(m.success).not.toHaveBeenCalled();

    await openDialog();
    expect(screen.getByRole("button", { name: "Copy 3 Tasks" })).toBeEnabled();
    expect(screen.queryByText(/The last copy stopped/)).not.toBeInTheDocument();
  });

  it("starts over after a failure, saying the partial table stays in Files", async () => {
    m.batch.mockRejectedValueOnce(new Error("offline"));
    const update = show({ notLoaded: 0 });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
    await waitFor(() => expect(m.error).toHaveBeenCalled());
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      /Or start over with the Tasks on the board now: the unfinished table stays in Files, where you can delete it\./,
    );

    update({ notLoaded: 0, shown: [tasks[0]] });
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy 1 Task" }));
    await waitFor(() => expect(m.success).toHaveBeenCalled());
    expect(m.create).toHaveBeenCalledTimes(2);
    expect(m.batch.mock.calls[1][1].insert).toHaveLength(1);
  });

  it("offers to start over without a partial-table notice when no table was made", async () => {
    m.create.mockRejectedValueOnce(new Error("Project closed"));
    show({ notLoaded: 0 });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
    await waitFor(() => expect(m.error).toHaveBeenCalled());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleDescription(
      /Or start over with the Tasks on the board now\.$/,
    );
    expect(dialog).not.toHaveAccessibleDescription(/unfinished table/);
  });
});
