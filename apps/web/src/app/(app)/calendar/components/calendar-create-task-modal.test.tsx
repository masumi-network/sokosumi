import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskStatus } from "@/lib/clients/generated/core";

const {
  createScheduledTaskMock,
  createTaskMock,
  createTaskModalMock,
  useCreateTaskModalMock,
} = vi.hoisted(() => ({
  createScheduledTaskMock: vi.fn(),
  createTaskMock: vi.fn(),
  createTaskModalMock: vi.fn(),
  useCreateTaskModalMock: vi.fn(() => ({ formInstanceKey: 1 })),
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  CreateTaskModal: (props: unknown) => {
    createTaskModalMock(props);
    return null;
  },
  useCreateTaskModal: useCreateTaskModalMock,
}));

vi.mock("@/lib/actions/task/action", () => ({
  createScheduledTask: createScheduledTaskMock,
  createTask: createTaskMock,
}));

import { CalendarCreateTaskModal } from "./calendar-create-task-modal";

const CONTEXT = {
  brand: { enabled: true, source: "project" as const, custom: null },
  briefingEnabled: true,
  contextMdEnabled: false,
};

function getCreateHandler() {
  const props = createTaskModalMock.mock.calls.at(-1)?.[0] as {
    onCreateTask: (input: {
      description: string;
      assigneeId: string | null;
      assigneeSokoBotId: string | null;
      projectId?: string | null;
      context: typeof CONTEXT;
      status: typeof TaskStatus.DRAFT | typeof TaskStatus.READY;
      schedule: {
        mode: "none" | "once";
        timezone: string;
        oneTimeLocalIso?: string;
      };
    }) => Promise<unknown>;
  };
  return props.onCreateTask;
}

describe("CalendarCreateTaskModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createScheduledTaskMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1", name: "Prepare launch" },
    });
    createTaskMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1", name: "Prepare launch" },
    });
  });

  it("uses the Calendar API for an active schedule and selected Project", async () => {
    render(
      <CalendarCreateTaskModal
        coworkerOptions={[]}
        projectOptions={[]}
        lockProjectSelection
      />,
    );

    await act(() =>
      getCreateHandler()({
        description: "Prepare launch",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        projectId: "11111111-1111-4111-8111-111111111111",
        context: CONTEXT,
        status: TaskStatus.READY,
        schedule: {
          mode: "once",
          oneTimeLocalIso: "2030-01-02T09:00",
          timezone: "UTC",
        },
      }),
    );

    expect(createScheduledTaskMock).toHaveBeenCalledWith({
      operationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      source: {
        type: "project",
        projectId: "11111111-1111-4111-8111-111111111111",
      },
      description: "Prepare launch",
      assigneeId: "coworker-1",
      context: CONTEXT,
      schedule: {
        mode: "once",
        oneTimeLocalIso: "2030-01-02T09:00",
        timezone: "UTC",
      },
    });
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: TaskStatus.DRAFT, mode: "once" as const },
    { status: TaskStatus.READY, mode: "none" as const },
  ])(
    "uses normal task creation for $status with $mode schedule",
    async (input) => {
      render(
        <CalendarCreateTaskModal coworkerOptions={[]} projectOptions={[]} />,
      );
      const createInput = {
        description: "Prepare launch",
        assigneeId: "coworker-1",
        assigneeSokoBotId: null,
        projectId: null,
        context: CONTEXT,
        status: input.status,
        schedule:
          input.mode === "once"
            ? {
                mode: "once" as const,
                oneTimeLocalIso: "2030-01-02T09:00",
                timezone: "UTC",
              }
            : { mode: "none" as const, timezone: "UTC" },
      };

      await act(() => getCreateHandler()(createInput));

      expect(createTaskMock).toHaveBeenCalledWith(createInput);
      expect(createScheduledTaskMock).not.toHaveBeenCalled();
    },
  );

  it("keeps the operation ID stable when a scheduled request is retried", async () => {
    createScheduledTaskMock.mockResolvedValue({
      ok: false,
      error: { kind: "calendar_client_upgrade_required" },
    });
    render(
      <CalendarCreateTaskModal coworkerOptions={[]} projectOptions={[]} />,
    );
    const input = {
      description: "Prepare launch",
      assigneeId: "coworker-1",
      assigneeSokoBotId: null,
      projectId: null,
      context: CONTEXT,
      status: TaskStatus.READY,
      schedule: {
        mode: "once" as const,
        oneTimeLocalIso: "2030-01-02T09:00",
        timezone: "UTC",
      },
    };

    await act(() => getCreateHandler()(input));
    await act(() => getCreateHandler()(input));

    expect(createScheduledTaskMock).toHaveBeenCalledTimes(2);
    expect(createScheduledTaskMock.mock.calls[0]?.[0].operationId).toBe(
      createScheduledTaskMock.mock.calls[1]?.[0].operationId,
    );
  });
});
