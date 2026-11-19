import { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportTasks, previewTasksExport } from "@/app/tasks/actions";
import messages from "../../../../../messages/en.json";
import { TasksExportDialog } from "./tasks-export-dialog";

vi.mock("@/app/tasks/actions", () => ({
  exportTasks: vi.fn(),
  previewTasksExport: vi.fn(),
}));

const exportTasksMock = vi.mocked(exportTasks);
const previewMock = vi.mocked(previewTasksExport);

function row(name: string) {
  return {
    identifier: null,
    name,
    status: TaskStatus.READY,
    priority: TaskPriority.MEDIUM,
    assignee: "Elena",
    owner: null,
    project: null,
    dueOn: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
}

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <TasksExportDialog
          open
          onOpenChange={onOpenChange}
          filters={{} as Parameters<typeof exportTasks>[0]}
          activeFilters={["Tasks view: My tasks", "Status: Ready"]}
          sortLabel="Priority"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe("TasksExportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:tasks");
    URL.revokeObjectURL = vi.fn();
  });

  it("names the view, filters and sort the file follows", async () => {
    previewMock.mockResolvedValue({ rows: [row("A")], matched: 1 });
    renderDialog();

    const list = screen.getByRole("list", { name: "View and filters" });
    expect(list).toHaveTextContent("My tasks");
    expect(list).toHaveTextContent("Status: Ready");
    expect(list).toHaveTextContent("Sort: Priority");
    expect(await screen.findByText("1 task matches")).toBeInTheDocument();
  });

  it("counts every match past the limit and says the file stops there", async () => {
    previewMock.mockResolvedValue({
      rows: ["A", "B", "C"].map(row),
      matched: 1500,
    });
    renderDialog();

    expect(await screen.findByText("1,500 tasks match")).toBeInTheDocument();
    expect(screen.getByText(/The file holds the first 1,000/)).toBeVisible();
    // Opening reads only the preview; the full export waits for Export.
    expect(exportTasksMock).not.toHaveBeenCalled();
  });

  it("previews the first rows, then exports every row and closes", async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    previewMock.mockResolvedValue({
      rows: ["A", "B", "C"].map(row),
      matched: 4,
    });
    exportTasksMock.mockResolvedValue({
      rows: ["A", "B", "C", "D"].map(row),
      truncated: false,
    });
    const onOpenChange = renderDialog();

    await user.click(await screen.findByRole("button", { name: "Preview" }));
    // Header plus three rows.
    expect(screen.getAllByRole("row")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect((await blob.text()).trim().split("\n")).toHaveLength(5);
    expect(click).toHaveBeenCalledTimes(1);
    expect(exportTasksMock).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("saves no file when the reader cancels while the export runs", async () => {
    const user = userEvent.setup();
    previewMock.mockResolvedValue({ rows: [row("A")], matched: 1 });
    let finish: (value: Awaited<ReturnType<typeof exportTasks>>) => void =
      () => {};
    exportTasksMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <QueryClientProvider client={new QueryClient()}>
          <NextIntlClientProvider locale="en" messages={messages}>
            <TasksExportDialog
              open={open}
              onOpenChange={setOpen}
              filters={{} as Parameters<typeof exportTasks>[0]}
              activeFilters={[]}
              sortLabel="Priority"
            />
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
    }
    render(<Harness />);

    await screen.findByText("1 task matches");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await act(async () => finish({ rows: [row("A")], truncated: false }));

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("offers no export when nothing matches", async () => {
    previewMock.mockResolvedValue({ rows: [], matched: 0 });
    renderDialog();

    expect(await screen.findByText("No tasks match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
