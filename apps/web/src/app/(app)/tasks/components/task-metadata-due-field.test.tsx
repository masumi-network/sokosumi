import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFormats } from "@/i18n/time-format";
import en from "@/messages/en.json";
import { TaskMetadataDueField } from "./task-metadata-due-field";

const { refreshMock, setTaskDueOnMock, toastErrorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  setTaskDueOnMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/actions/task/action", () => ({
  setTaskDueOn: setTaskDueOnMock,
}));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

function renderField(dueOn: string | null) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      now={new Date("2026-11-10T12:00:00.000Z")}
      formats={createFormats()}
      messages={{ App: { Tasks: { Due: en.App.Tasks.Due } } }}
    >
      <TaskMetadataDueField taskId="task-1" dueOn={dueOn} status="RUNNING" />
    </NextIntlClientProvider>,
  );
}

describe("TaskMetadataDueField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTaskDueOnMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
  });

  it.each([
    [null, "No due date", "Set a due date"],
    ["2026-11-20", "Due Nov 20", "Change due date"],
    ["2026-11-09", "Overdue · Nov 9", "Change due date"],
  ])("names the %s button by its visible label", (dueOn, label, action) => {
    renderField(dueOn);

    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveTextContent(label);
    expect(button).toHaveAccessibleDescription(action);
  });

  it("sets a due date from the date field", async () => {
    const user = userEvent.setup();
    renderField(null);

    await user.click(screen.getByRole("button", { name: "No due date" }));
    await user.type(screen.getByLabelText("Due date"), "2026-11-20");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(setTaskDueOnMock).toHaveBeenCalledWith({
      taskId: "task-1",
      dueOn: "2026-11-20",
    });
    expect(await screen.findByText("Due Nov 20")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("clears a due date", async () => {
    const user = userEvent.setup();
    renderField("2026-11-09");

    expect(screen.getByText("Overdue · Nov 9")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Overdue · Nov 9" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(setTaskDueOnMock).toHaveBeenCalledWith({
      taskId: "task-1",
      dueOn: null,
    });
    expect(await screen.findByText("No due date")).toBeInTheDocument();
  });

  it("restores the old date and says so when Core refuses", async () => {
    setTaskDueOnMock.mockResolvedValue({ ok: false, error: "forbidden" });
    const user = userEvent.setup();
    renderField("2026-11-20");

    await user.click(screen.getByRole("button", { name: "Due Nov 20" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(await screen.findByText("Due Nov 20")).toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith(en.App.Tasks.Due.updateError);
  });
});
