import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestQueryProvider } from "@/test/query-provider";

import { ProjectMoveDatesDialog } from "./project-move-dates-dialog";

const { shiftProjectDueDatesAction, toast } = vi.hoisted(() => ({
  shiftProjectDueDatesAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

function translate(key: string, values?: Record<string, unknown>): string {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

vi.mock("next-intl", () => ({
  useTranslations: () => translate,
  useFormatter: () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/projects/actions", () => ({ shiftProjectDueDatesAction }));

const PROJECT_ID = "project-1";

function previewOf(days: number) {
  return {
    tasks: [
      { id: "a", name: "Draft launch post", from: "2026-11-20" },
      { id: "b", name: "Book venue", from: "2026-12-01" },
    ].map((task) => ({
      ...task,
      to: new Date(Date.parse(task.from) + days * 86_400_000)
        .toISOString()
        .slice(0, 10),
    })),
    skipped: 0,
    overLimit: false,
  };
}

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <TestQueryProvider>
      <ProjectMoveDatesDialog
        projectId={PROJECT_ID}
        open
        onOpenChange={onOpenChange}
      />
    </TestQueryProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  shiftProjectDueDatesAction.mockImplementation(
    async ({ days, tasks }: { days: number; tasks?: unknown[] }) =>
      tasks
        ? {
            ...previewOf(days),
            tasks: previewOf(days).tasks.slice(1),
            skipped: 1,
          }
        : previewOf(days),
  );
});

describe("ProjectMoveDatesDialog", () => {
  it("previews each Task's old and new due day for a week later", async () => {
    renderDialog();

    expect(await screen.findByText("Draft launch post")).toBeInTheDocument();
    expect(shiftProjectDueDatesAction).toHaveBeenLastCalledWith({
      projectId: PROJECT_ID,
      days: 7,
    });
    expect(screen.getByText("2026-11-20")).toBeInTheDocument();
    expect(screen.getByText("2026-11-27")).toBeInTheDocument();
  });

  it("previews earlier dates when Earlier is chosen", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText("Draft launch post");

    await user.click(screen.getByLabelText("earlier"));

    expect(await screen.findByText("2026-11-13")).toBeInTheDocument();
    expect(shiftProjectDueDatesAction).toHaveBeenLastCalledWith({
      projectId: PROJECT_ID,
      days: -7,
    });
  });

  it("confirms exactly the previewed Tasks and days, then reports what kept its day", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await screen.findByText("Draft launch post");

    await user.click(
      screen.getByRole("button", { name: 'confirm:{"count":2}' }),
    );

    await waitFor(() =>
      expect(shiftProjectDueDatesAction).toHaveBeenLastCalledWith({
        projectId: PROJECT_ID,
        days: 7,
        tasks: [
          { id: "a", from: "2026-11-20" },
          { id: "b", from: "2026-12-01" },
        ],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      'moved:{"count":1}',
      expect.objectContaining({ description: 'skipped:{"count":1}' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("can't confirm a preview made for other days than the field now shows", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText("Draft launch post");

    await user.clear(screen.getByLabelText("daysLabel"));
    await user.type(screen.getByLabelText("daysLabel"), "3");

    expect(
      screen.getByRole("button", { name: 'confirm:{"count":0}' }),
    ).toBeDisabled();
    expect(await screen.findByText("2026-11-23")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'confirm:{"count":2}' }),
    ).toBeEnabled();
  });

  it("says nothing moves when the project has no open dated Tasks", async () => {
    shiftProjectDueDatesAction.mockResolvedValue({
      tasks: [],
      skipped: 0,
      overLimit: false,
    });
    renderDialog();

    expect(await screen.findByText("empty")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'confirm:{"count":0}' }),
    ).toBeDisabled();
  });

  it("refuses a project with more Tasks than one move takes", async () => {
    shiftProjectDueDatesAction.mockResolvedValue({
      ...previewOf(7),
      overLimit: true,
    });
    renderDialog();

    expect(await screen.findByText('tooMany:{"max":100}')).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'confirm:{"count":2}' }),
    ).toBeDisabled();
  });

  it("shows an error when the preview fails", async () => {
    shiftProjectDueDatesAction.mockRejectedValue(new Error("down"));
    renderDialog();

    expect(await screen.findByText("previewError")).toBeInTheDocument();
  });
});
