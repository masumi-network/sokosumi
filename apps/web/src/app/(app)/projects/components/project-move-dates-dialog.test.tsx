import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectMoveDatesDialog } from "./project-move-dates-dialog";

const { shiftProjectDueDatesAction, refresh, toast } = vi.hoisted(() => ({
  shiftProjectDueDatesAction: vi.fn(),
  refresh: vi.fn(),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/projects/actions", () => ({ shiftProjectDueDatesAction }));

const PROJECT_ID = "project-1";

function previewOf(days: number, total = 2) {
  return {
    tasks: [
      { id: "a", name: "Draft launch post", from: "2026-11-20", to: "" },
      { id: "b", name: "Book venue", from: "2026-12-01", to: "" },
    ].map((task) => ({
      ...task,
      to: new Date(Date.parse(task.from) + days * 86_400_000)
        .toISOString()
        .slice(0, 10),
    })),
    total,
    skipped: 0,
  };
}

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <ProjectMoveDatesDialog
      projectId={PROJECT_ID}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  shiftProjectDueDatesAction.mockImplementation(
    async ({ days, preview }: { days: number; preview?: boolean }) =>
      preview ? previewOf(days) : { ...previewOf(days), skipped: 1 },
  );
});

describe("ProjectMoveDatesDialog", () => {
  it("previews each Task's old and new due day for a week later", async () => {
    renderDialog();

    expect(await screen.findByText("Draft launch post")).toBeInTheDocument();
    expect(shiftProjectDueDatesAction).toHaveBeenLastCalledWith({
      projectId: PROJECT_ID,
      days: 7,
      preview: true,
    });
    expect(screen.getByText("2026-11-20")).toBeInTheDocument();
    expect(screen.getByText("2026-11-27")).toBeInTheDocument();
  });

  it("previews earlier dates when Earlier is chosen", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText("Draft launch post");

    await user.click(screen.getByLabelText("earlier"));

    await waitFor(() =>
      expect(shiftProjectDueDatesAction).toHaveBeenLastCalledWith({
        projectId: PROJECT_ID,
        days: -7,
        preview: true,
      }),
    );
    expect(await screen.findByText("2026-11-13")).toBeInTheDocument();
  });

  it("moves the dates, reports what kept its day, and closes", async () => {
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
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      'moved:{"count":2}',
      expect.objectContaining({ description: 'skipped:{"count":1}' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("says nothing moves when the project has no open dated Tasks", async () => {
    shiftProjectDueDatesAction.mockResolvedValue({
      tasks: [],
      total: 0,
      skipped: 0,
    });
    renderDialog();

    expect(await screen.findByText("empty")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'confirm:{"count":0}' }),
    ).toBeDisabled();
  });

  it("refuses a project with more Tasks than one move takes", async () => {
    shiftProjectDueDatesAction.mockResolvedValue(previewOf(7, 101));
    renderDialog();

    expect(
      await screen.findByText('tooMany:{"count":101,"max":100}'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'confirm:{"count":101}' }),
    ).toBeDisabled();
  });

  it("shows an error when the preview fails", async () => {
    shiftProjectDueDatesAction.mockRejectedValue(new Error("down"));
    renderDialog();

    expect(await screen.findByText("previewError")).toBeInTheDocument();
  });
});
