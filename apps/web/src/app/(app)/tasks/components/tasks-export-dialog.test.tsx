import { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportTasks } from "@/app/tasks/actions";
import messages from "../../../../../messages/en.json";
import { TasksExportDialog } from "./tasks-export-dialog";

vi.mock("@/app/tasks/actions", () => ({ exportTasks: vi.fn() }));

const exportTasksMock = vi.mocked(exportTasks);

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
          activeFilters={["My tasks", "Status: Ready"]}
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
    exportTasksMock.mockResolvedValue({
      rows: [row("A")],
      truncated: false,
      matched: 1,
    });
    renderDialog();

    const list = screen.getByRole("list", { name: "View and filters" });
    expect(list).toHaveTextContent("My tasks");
    expect(list).toHaveTextContent("Status: Ready");
    expect(list).toHaveTextContent("Sort: Priority");
    expect(await screen.findByText("1 task matches")).toBeInTheDocument();
  });

  it("counts every match past the limit and says the file stops there", async () => {
    exportTasksMock.mockResolvedValue({
      rows: Array.from({ length: 1000 }, (_, index) => row(`T${index}`)),
      truncated: true,
      matched: 1500,
    });
    renderDialog();

    expect(await screen.findByText("1,500 tasks match")).toBeInTheDocument();
    expect(screen.getByText(/The file holds the first 1,000/)).toBeVisible();
  });

  it("previews three rows, then downloads the counted rows and closes", async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    exportTasksMock.mockResolvedValue({
      rows: ["A", "B", "C", "D"].map(row),
      truncated: false,
      matched: 4,
    });
    const onOpenChange = renderDialog();

    await user.click(await screen.findByRole("button", { name: "Preview" }));
    // Header plus three rows.
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByRole("cell", { name: "D" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export" }));

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect((await blob.text()).trim().split("\n")).toHaveLength(5);
    expect(click).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(exportTasksMock).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("offers no export when nothing matches", async () => {
    exportTasksMock.mockResolvedValue({
      rows: [],
      truncated: false,
      matched: 0,
    });
    renderDialog();

    expect(await screen.findByText("No tasks match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
