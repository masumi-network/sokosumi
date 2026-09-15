import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const moveCalendarTaskSourceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/task/action", () => ({
  moveCalendarTaskSource: (...args: unknown[]) =>
    moveCalendarTaskSourceMock(...args),
}));

import { TaskScheduleSourceMove } from "./task-schedule-source-move";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCES = [
  {
    sourceId: "workspace:22222222-2222-4222-8222-222222222222",
    sourceType: "WORKSPACE" as const,
    displayName: "Acme",
    logoUrl: null,
    paletteToken: "blue" as const,
    isSchedulable: true,
  },
  {
    sourceId: `project:${PROJECT_ID}`,
    sourceType: "PROJECT" as const,
    displayName: "Launch",
    logoUrl: null,
    paletteToken: "violet" as const,
    isSchedulable: true,
  },
];

describe("TaskScheduleSourceMove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "operation-1" });
  });

  it("confirms and submits a Project source with the observed revision", async () => {
    moveCalendarTaskSourceMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1", scheduleRevision: 5 },
    });
    render(
      <TaskScheduleSourceMove
        taskId="task-1"
        currentSourceId={SOURCES[0].sourceId}
        scheduleRevision={4}
        futureExceptionCount={2}
        sources={SOURCES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "moveSource" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Launch" }));
    expect(screen.getByText("moveSourceDescription:2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "moveSourceConfirm" }));

    await waitFor(() =>
      expect(moveCalendarTaskSourceMock).toHaveBeenCalledWith({
        taskId: "task-1",
        operationId: "operation-1",
        expectedScheduleRevision: 4,
        source: { type: "project", projectId: PROJECT_ID },
      }),
    );
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("omits the control when there is no other selectable source", () => {
    render(
      <TaskScheduleSourceMove
        taskId="task-1"
        currentSourceId={SOURCES[0].sourceId}
        scheduleRevision={4}
        futureExceptionCount={0}
        sources={[SOURCES[0]]}
      />,
    );

    expect(screen.queryByRole("button", { name: "moveSource" })).toBeNull();
  });
});
