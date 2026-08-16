import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectForm } from "@/app/projects/components/project-form";
import { createProject, updateProject } from "@/lib/actions/project/action";
import type { Project } from "@/lib/clients/generated/core/types.gen";

const pushMock = vi.fn();
const toastErrorMock = vi.fn();
const trackMock = vi.fn();

vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/actions/project/action", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    return (key: string, values?: Record<string, unknown>) => {
      if (key === "label") return "Briefing";
      if (key === "placeholder") return "Briefing";
      if (key === "wordCount") return `${values?.count ?? 0} words`;
      if (key.startsWith("chips.")) return key.slice("chips.".length);
      return key;
    };
  },
}));

const baseLabels = {
  details: "Details",
  detailsDescription: "Describe the project",
  name: "Project name",
  namePlaceholder: "Name",
  submit: "Save project",
  cancel: "Cancel",
  error: "Project could not be saved",
};

const CREATED_PROJECT = {
  id: "project-1",
  workspaceId: "workspace-1",
  name: "Launch plan",
  briefing: null,
  briefingUrl: null,
  websiteUrl: null,
  logo: null,
  designMd: null,
  contextMd: null,
  contextMdUpdating: false,
  memoryEnabled: false,
  memoryModel: {
    id: "mistral/mistral-medium-3.5",
    label: "Mistral Medium",
    region: "eu",
  },
  createdAt: new Date("2026-05-27T10:00:00.000Z"),
  updatedAt: new Date("2026-05-27T10:00:00.000Z"),
} satisfies Project;

describe("ProjectForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a non-blank name before submitting", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      projectId: "project-1",
      project: CREATED_PROJECT,
    });

    render(
      <ProjectForm
        mode="create"
        labels={baseLabels}
        showCancel={false}
        onSuccess={vi.fn()}
      />,
    );

    const submitButton = screen.getByRole("button", { name: "Save project" });
    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText("Project name"), "   ");
    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText("Project name"), "Launch plan");
    expect(submitButton).toBeEnabled();
  });

  it("submits normalized create values and calls onSuccess", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      projectId: "project-1",
      project: CREATED_PROJECT,
    });

    render(
      <ProjectForm
        mode="create"
        labels={baseLabels}
        showCancel={false}
        onSuccess={onSuccess}
      />,
    );

    await user.type(screen.getByLabelText("Project name"), "  Launch plan  ");
    await user.type(screen.getByLabelText("Briefing"), "  Ship it  ");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "Launch plan",
        briefing: "Ship it",
        websiteUrl: null,
      });
    });
    expect(onSuccess).toHaveBeenCalledWith("project-1", "Launch plan");
    expect(trackMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("tracks project creation with the provided source", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      projectId: "project-1",
      project: CREATED_PROJECT,
    });

    render(
      <ProjectForm
        mode="create"
        labels={baseLabels}
        showCancel={false}
        creationSource="task_form"
        onSuccess={onSuccess}
      />,
    );

    await user.type(screen.getByLabelText("Project name"), "Launch plan");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith("Project created", {
        source: "task_form",
        variant: "page",
      });
    });
  });

  it("submits normalized edit values through updateProject", async () => {
    const user = userEvent.setup();
    const updateProjectMock = vi.mocked(updateProject);
    updateProjectMock.mockResolvedValue({ projectId: "project-1" });

    render(
      <ProjectForm
        mode="edit"
        projectId="project-1"
        labels={baseLabels}
        initialValues={{
          name: "Old name",
          briefing: "Old briefing",
        }}
        showCancel={false}
      />,
    );

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), " Updated name ");
    await user.clear(screen.getByLabelText("Briefing"));
    await user.type(screen.getByLabelText("Briefing"), "   ");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "Updated name",
        briefing: null,
        websiteUrl: null,
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/projects/project-1");
  });
});
