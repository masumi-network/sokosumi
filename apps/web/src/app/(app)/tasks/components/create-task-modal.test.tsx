import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreateTaskModal,
  CreateTaskModalProvider,
  useCreateTaskModal,
} from "./create-task-modal";

const { taskFormPropsSpy, routerReplaceMock } = vi.hoisted(() => ({
  taskFormPropsSpy: vi.fn(),
  routerReplaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({
    push: vi.fn(),
    replace: routerReplaceMock,
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
  TaskFormModal: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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

  it("leaves the project unselected for an unfiltered Calendar", async () => {
    await openFromCalendar({ projectId: undefined });

    expect(getLatestProjectId()).toBeUndefined();
  });

  it("preselects the Workspace for an explicit Workspace source", async () => {
    await openFromCalendar({ projectId: null });

    expect(getLatestProjectId()).toBeNull();
  });

  it("preselects the Project for an explicit Project source", async () => {
    await openFromCalendar({ projectId: "project-1" });

    expect(getLatestProjectId()).toBe("project-1");
  });

  it("falls back to the route Project on a Project Calendar", async () => {
    await openFromCalendar({}, { initialProjectId: "project-1" });

    expect(getLatestProjectId()).toBe("project-1");
  });

  it("keeps the Workspace default when a caller omits the project", async () => {
    await openFromCalendar({});

    expect(getLatestProjectId()).toBeNull();
  });

  describe("dismiss", () => {
    afterEach(() => {
      window.history.replaceState({}, "", "/");
    });

    function dismissLatestForm() {
      const props = taskFormPropsSpy.mock.calls.at(-1)?.[0] as {
        onCancel: () => void;
      };
      act(() => props.onCancel());
    }

    it("clears the deep-link params from the URL when opened by ?create=true", () => {
      window.history.replaceState({}, "", "/calendar?create=true&assignee=cow");
      render(
        <CreateTaskModalProvider initialOpen>
          <CreateTaskModal coworkerOptions={[]} initialCreateTaskOpen />
        </CreateTaskModalProvider>,
      );

      dismissLatestForm();

      expect(routerReplaceMock).toHaveBeenCalledWith("/calendar");
    });

    it("leaves the page URL alone when opened in place", () => {
      window.history.replaceState({}, "", "/calendar?create=true");
      render(
        <CreateTaskModalProvider initialOpen>
          <CreateTaskModal coworkerOptions={[]} />
        </CreateTaskModalProvider>,
      );

      dismissLatestForm();

      expect(routerReplaceMock).not.toHaveBeenCalled();
    });
  });

  it("shows a loading state instead of the form while the wizard lists load", () => {
    render(
      <CreateTaskModalProvider initialOpen>
        <CreateTaskModal coworkerOptions={[]} isLoadingOptions />
      </CreateTaskModalProvider>,
    );

    expect(screen.getByTestId("new-task-wizard-loading")).toBeInTheDocument();
    expect(taskFormPropsSpy).not.toHaveBeenCalled();
  });
});
