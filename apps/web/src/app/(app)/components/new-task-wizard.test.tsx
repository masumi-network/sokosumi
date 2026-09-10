import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadCreateTaskModalDataMock,
  loadNewTaskWizardOptionsMock,
  taskFormPropsSpy,
  toastErrorMock,
} = vi.hoisted(() => ({
  loadCreateTaskModalDataMock: vi.fn(),
  loadNewTaskWizardOptionsMock: vi.fn(),
  taskFormPropsSpy: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
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
  toast: { error: toastErrorMock },
}));

vi.mock("@/app/tasks/actions", () => ({
  loadCreateTaskModalData: loadCreateTaskModalDataMock,
  loadNewTaskWizardOptions: loadNewTaskWizardOptionsMock,
}));

vi.mock("@/app/tasks/components/task-form-modal", () => ({
  TaskFormModal: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (
    <div data-testid="task-form-modal" data-open={String(open)}>
      {children}
    </div>
  ),
}));

vi.mock("@/app/tasks/components/task-form", () => ({
  TaskForm: (props: unknown) => {
    taskFormPropsSpy(props);
    return null;
  },
}));

import { NewTaskWizard } from "./new-task-wizard";

const COWORKER = {
  id: "coworker-1",
  slug: "coworker-one",
  name: "Coworker One",
  image: "",
  vendor: { id: "vendor-1", name: "Vendor", slug: "vendor", logos: {} },
};
const PROJECT = { id: "project-1", name: "Project One" };

function renderWizard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NewTaskWizard instance={1} />
    </QueryClientProvider>,
  );
}

function getLatestTaskFormProps() {
  return taskFormPropsSpy.mock.calls.at(-1)?.[0] as {
    coworkerOptions: Array<{ id: string }>;
    projectOptions: Array<{ id: string }>;
    agentNameById: Map<string, string>;
    initialDesignMdAttachment: { url: string } | null;
  };
}

describe("NewTaskWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens with a loading state, then shows the form with everything from one call", async () => {
    loadNewTaskWizardOptionsMock.mockResolvedValue({
      coworkerOptions: [COWORKER],
      projectOptions: [PROJECT],
      agentNameById: { "agent-1": "Agent One" },
      designMdAttachment: { url: "https://example.com/design.md" },
    });

    renderWizard();

    expect(screen.getByTestId("task-form-modal")).toHaveAttribute(
      "data-open",
      "true",
    );
    expect(screen.getByTestId("new-task-wizard-loading")).toBeInTheDocument();
    expect(taskFormPropsSpy).not.toHaveBeenCalled();

    await waitFor(() => expect(taskFormPropsSpy).toHaveBeenCalled());

    expect(screen.queryByTestId("new-task-wizard-loading")).toBeNull();
    expect(getLatestTaskFormProps().coworkerOptions.map((o) => o.id)).toEqual([
      "coworker-1",
    ]);
    expect(getLatestTaskFormProps().projectOptions.map((o) => o.id)).toEqual([
      "project-1",
    ]);
    expect(getLatestTaskFormProps().agentNameById.get("agent-1")).toBe(
      "Agent One",
    );
    expect(getLatestTaskFormProps().initialDesignMdAttachment).toEqual({
      url: "https://example.com/design.md",
    });
    expect(loadCreateTaskModalDataMock).not.toHaveBeenCalled();
  });

  it("closes with an error toast when the lists fail to load", async () => {
    loadNewTaskWizardOptionsMock.mockRejectedValue(new Error("core down"));
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <NewTaskWizard instance={1} onClose={onClose} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("loadCreateTask"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.getByTestId("task-form-modal")).toHaveAttribute(
      "data-open",
      "false",
    );
    expect(taskFormPropsSpy).not.toHaveBeenCalled();
  });
});
