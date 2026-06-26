import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectForm } from "@/app/projects/components/project-form";
import { createProject, updateProject } from "@/lib/actions/project/action";

const pushMock = vi.fn();
const toastErrorMock = vi.fn();

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

const baseLabels = {
  details: "Details",
  detailsDescription: "Describe the project",
  name: "Project name",
  namePlaceholder: "Name",
  description: "Description",
  descriptionPlaceholder: "Description",
  submit: "Save project",
  cancel: "Cancel",
  error: "Project could not be saved",
};

describe("ProjectForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a non-blank name before submitting", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({ projectId: "project-1" });

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
    createProjectMock.mockResolvedValue({ projectId: "project-1" });

    render(
      <ProjectForm
        mode="create"
        labels={baseLabels}
        showCancel={false}
        onSuccess={onSuccess}
      />,
    );

    await user.type(screen.getByLabelText("Project name"), "  Launch plan  ");
    await user.type(screen.getByLabelText("Description"), "  Ship it  ");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "Launch plan",
        description: "Ship it",
      });
    });
    expect(onSuccess).toHaveBeenCalledWith("project-1", "Launch plan");
    expect(pushMock).not.toHaveBeenCalled();
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
          description: "Old description",
        }}
        showCancel={false}
      />,
    );

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), " Updated name ");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "   ");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "Updated name",
        description: null,
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/projects/project-1");
  });
});
