import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const searchParamsStore = {
  current: new URLSearchParams(),
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => searchParamsStore.current,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      ariaLabel: "Project",
      allProjects: "All projects",
      searchPlaceholder: "Search projects...",
      empty: "No projects found.",
      create: "Create project...",
    };
    return labels[key] ?? key;
  },
}));

vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (result: { projectId: string; name: string }) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="inline-create-project"
        onClick={() =>
          onCreated({
            projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            name: "Northstar",
          })
        }
      >
        Confirm create
      </button>
    ) : null,
}));

vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: ({ name }: { name: string }) => (
    <span data-testid="project-avatar">{name.charAt(0)}</span>
  ),
}));

import { TasksProjectSwitcher } from "../tasks-project-switcher";

const RESEARCH_ID = "33333333-3333-4333-8333-333333333333";

const projectOptions = [
  {
    id: RESEARCH_ID,
    name: "Research",
    logo: null,
  },
];

describe("TasksProjectSwitcher", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    searchParamsStore.current = new URLSearchParams();
    window.history.replaceState({}, "", "/tasks");
  });

  it("selects a project and writes projectId to the URL", async () => {
    const user = userEvent.setup();
    const onProjectCreated = vi.fn();

    render(
      <TasksProjectSwitcher
        projectOptions={projectOptions}
        selectedProjectId={null}
        onProjectCreated={onProjectCreated}
      />,
    );

    await user.click(screen.getByTestId("tasks-project-switcher"));
    await user.click(
      screen.getByTestId(`tasks-project-switcher-item-${RESEARCH_ID}`),
    );

    expect(replaceMock).toHaveBeenCalledWith(`/tasks?projectId=${RESEARCH_ID}`);
    expect(onProjectCreated).not.toHaveBeenCalled();
  });

  it("clears projectId when All projects is selected", async () => {
    const user = userEvent.setup();
    searchParamsStore.current = new URLSearchParams(
      `projectId=${RESEARCH_ID}&status=READY`,
    );
    window.history.replaceState(
      {},
      "",
      `/tasks?projectId=${RESEARCH_ID}&status=READY`,
    );

    render(
      <TasksProjectSwitcher
        projectOptions={projectOptions}
        selectedProjectId={RESEARCH_ID}
        onProjectCreated={vi.fn()}
      />,
    );

    expect(screen.getByTestId("tasks-project-switcher")).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(screen.getByTestId("tasks-project-switcher")).toHaveTextContent(
      "Research",
    );

    await user.click(screen.getByTestId("tasks-project-switcher"));
    await user.click(screen.getByTestId("tasks-project-switcher-all"));

    expect(replaceMock).toHaveBeenCalledWith("/tasks?status=READY");
  });

  it("creates a project and selects it", async () => {
    const user = userEvent.setup();
    const onProjectCreated = vi.fn();

    render(
      <TasksProjectSwitcher
        projectOptions={projectOptions}
        selectedProjectId={null}
        onProjectCreated={onProjectCreated}
      />,
    );

    await user.click(screen.getByTestId("tasks-project-switcher"));
    await user.click(screen.getByTestId("tasks-project-switcher-create"));
    await user.click(screen.getByTestId("inline-create-project"));

    expect(onProjectCreated).toHaveBeenCalledWith({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      name: "Northstar",
      logo: null,
      designMd: null,
      briefingUrl: null,
      contextMd: null,
    });
    expect(replaceMock).toHaveBeenCalledWith(
      "/tasks?projectId=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    );
  });
});
