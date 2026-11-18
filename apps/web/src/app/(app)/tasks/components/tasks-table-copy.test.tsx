import { render, screen, waitFor } from "@testing-library/react";
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

function show(props: {
  notLoaded: number | "unknown" | 0;
  shown?: TaskWithCoworker[];
}) {
  render(
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
      />
    </NextIntlClientProvider>,
  );
}

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
    expect(
      screen.getByText(/4 more Tasks match your filters but aren't loaded/),
    ).toBeInTheDocument();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("warns without a number when the list cannot count what is not loaded", async () => {
    show({ notLoaded: "unknown" });
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to table" }),
    );
    expect(
      screen.getByText(/More Tasks match your filters than are loaded/),
    ).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: "Copy 3 Tasks" }));
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
});
