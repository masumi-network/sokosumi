import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreateTaskModal,
  CreateTaskModalProvider,
  useCreateTaskModal,
} from "./create-task-modal";

const { taskFormModalPropsSpy, taskFormPropsSpy } = vi.hoisted(() => ({
  taskFormModalPropsSpy: vi.fn(),
  taskFormPropsSpy: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, {
      raw: (key: string) => key,
      has: () => true,
    }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/app/tasks/actions", () => ({
  loadCreateTaskModalData: vi.fn().mockResolvedValue({
    agentNameById: {},
    designMdAttachment: null,
  }),
}));

vi.mock("./task-form-modal", () => ({
  TaskFormModal: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    viewTransition?: boolean;
  }) => {
    taskFormModalPropsSpy(props);
    return <div>{children}</div>;
  },
}));

vi.mock("./task-form", () => ({
  TaskForm: (props: unknown) => {
    taskFormPropsSpy(props);
    return null;
  },
}));

const SCHEDULE = {
  mode: "once" as const,
  oneTimeLocalIso: "2030-01-02T09:00",
  timezone: "UTC",
};

function CalendarSlotButton({
  defaults,
}: {
  defaults: { projectId?: string | null };
}) {
  const { handleOpenWithDefaults } = useCreateTaskModal();

  return (
    <button
      type="button"
      onClick={() =>
        handleOpenWithDefaults({ ...defaults, schedule: SCHEDULE })
      }
    >
      open
    </button>
  );
}

function getLatestProjectId() {
  const props = taskFormPropsSpy.mock.calls.at(-1)?.[0] as {
    initialValues: { projectId?: string | null };
  };
  return props.initialValues.projectId;
}

async function openFromCalendar(
  defaults: { projectId?: string | null },
  { initialProjectId }: { initialProjectId?: string | null } = {},
) {
  const user = userEvent.setup();
  render(
    <CreateTaskModalProvider initialProjectId={initialProjectId ?? null}>
      <CalendarSlotButton defaults={defaults} />
      <CreateTaskModal coworkerOptions={[]} projectOptions={[]} />
    </CreateTaskModalProvider>,
  );

  await user.click(screen.getByRole("button", { name: "open" }));
}

describe("CreateTaskModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opts the create-task shell into View Transitions", () => {
    render(
      <CreateTaskModalProvider>
        <CreateTaskModal coworkerOptions={[]} projectOptions={[]} />
      </CreateTaskModalProvider>,
    );

    expect(taskFormModalPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ viewTransition: true }),
    );
  });

  it("leaves the project unselected for an unfiltered Calendar", async () => {
    await openFromCalendar({ projectId: undefined });

    await waitFor(() => {
      expect(getLatestProjectId()).toBeUndefined();
    });
  });

  it("preselects the Workspace for an explicit Workspace source", async () => {
    await openFromCalendar({ projectId: null });

    await waitFor(() => {
      expect(getLatestProjectId()).toBeNull();
    });
  });

  it("preselects the Project for an explicit Project source", async () => {
    await openFromCalendar({ projectId: "project-1" });

    await waitFor(() => {
      expect(getLatestProjectId()).toBe("project-1");
    });
  });

  it("falls back to the route Project on a Project Calendar", async () => {
    await openFromCalendar({}, { initialProjectId: "project-1" });

    await waitFor(() => {
      expect(getLatestProjectId()).toBe("project-1");
    });
  });

  it("keeps the Workspace default when a caller omits the project", async () => {
    await openFromCalendar({});

    await waitFor(() => {
      expect(getLatestProjectId()).toBeNull();
    });
  });
});
