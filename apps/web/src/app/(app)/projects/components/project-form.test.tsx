import type { Project } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectForm } from "@/app/projects/components/project-form";
import { createProject, updateProject } from "@/lib/actions/project/action";

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
      if (key === "Wizard.name.identifierLabel") return "Identifier";
      if (key === "Wizard.name.identifierHint")
        return `Hint ${values?.example}`;
      if (key === "Wizard.name.identifierInvalid") return "Identifier invalid";
      if (key === "Wizard.name.identifierTaken") return "Identifier taken";
      if (key === "Wizard.name.identifierImmutable")
        return "Identifier immutable";
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
  identifier: "LAUNCH",
  briefing: null,
  briefingUrl: null,
  websiteUrl: null,
  logo: null,
  designMd: null,
  contextMd: null,
  contextMdUpdating: false,
  latestUpdate: null,
  projectRevision: 0,
  closingAt: null,
  closedAt: null,
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
      ok: true,
      value: {
        projectId: "project-1",
        project: CREATED_PROJECT,
      },
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
      ok: true,
      value: {
        projectId: "project-1",
        project: CREATED_PROJECT,
      },
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
      ok: true,
      value: {
        projectId: "project-1",
        project: CREATED_PROJECT,
      },
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
    updateProjectMock.mockResolvedValue({
      ok: true,
      value: { projectId: "project-1" },
    });

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

  it("uppercases and sanitizes the identifier as you type", async () => {
    const user = userEvent.setup();
    render(
      <ProjectForm mode="create" labels={baseLabels} showCancel={false} />,
    );

    const input = screen.getByLabelText("Identifier");
    expect(input).toHaveAttribute("maxlength", "7");
    await user.type(input, "web-app_12345");

    expect(input).toHaveValue("WEBAPP1");
  });

  it("shows the current valid identifier in the helper text", async () => {
    const user = userEvent.setup();
    render(
      <ProjectForm mode="create" labels={baseLabels} showCancel={false} />,
    );

    expect(screen.getByText("Hint SOK-123")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Identifier"), "web");
    expect(screen.getByText("Hint WEB-123")).toBeInTheDocument();
  });

  it("flags an invalid identifier and blocks submit", async () => {
    const user = userEvent.setup();
    render(
      <ProjectForm mode="create" labels={baseLabels} showCancel={false} />,
    );

    await user.type(screen.getByLabelText("Project name"), "Launch plan");
    await user.type(screen.getByLabelText("Identifier"), "1a");

    expect(screen.getByText("Identifier invalid")).toBeInTheDocument();
    expect(screen.getByLabelText("Identifier")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("button", { name: "Save project" })).toBeDisabled();
  });

  it("omits the identifier from the create payload when left empty", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      ok: true,
      value: { projectId: "project-1", project: CREATED_PROJECT },
    });
    render(
      <ProjectForm
        mode="create"
        labels={baseLabels}
        showCancel={false}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Project name"), "Launch plan");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => expect(createProjectMock).toHaveBeenCalled());
    expect(createProjectMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "identifier",
    );
  });

  it("sends a typed identifier on create", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      ok: true,
      value: { projectId: "project-1", project: CREATED_PROJECT },
    });
    render(
      <ProjectForm
        mode="create"
        labels={baseLabels}
        showCancel={false}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Project name"), "Launch plan");
    await user.type(screen.getByLabelText("Identifier"), "lp");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() =>
      expect(createProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: "LP" }),
      ),
    );
  });

  it("prefills the identifier on edit and requires it", async () => {
    const user = userEvent.setup();
    render(
      <ProjectForm
        mode="edit"
        projectId="project-1"
        labels={baseLabels}
        initialValues={{ name: "Old name", identifier: "OLD" }}
        showCancel={false}
      />,
    );

    const input = screen.getByLabelText("Identifier");
    expect(input).toHaveValue("OLD");
    expect(screen.getByRole("button", { name: "Save project" })).toBeEnabled();

    await user.clear(input);
    expect(screen.getByRole("button", { name: "Save project" })).toBeDisabled();
  });

  it("shows a taken identifier on the field instead of a toast, and clears it on edit", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProject).mockResolvedValue({
      ok: false,
      error: { kind: "identifier_taken" },
    });
    render(
      <ProjectForm
        mode="edit"
        projectId="project-1"
        labels={baseLabels}
        initialValues={{ name: "Old name", identifier: "OLD" }}
        showCancel={false}
      />,
    );

    await user.type(screen.getByLabelText("Identifier"), "1");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    expect(await screen.findByText("Identifier taken")).toBeInTheDocument();
    expect(screen.getByLabelText("Identifier")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Identifier"), "2");
    expect(screen.queryByText("Identifier taken")).not.toBeInTheDocument();
  });

  it("shows an immutable identifier on the field instead of a toast", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProject).mockResolvedValue({
      ok: false,
      error: { kind: "identifier_immutable" },
    });
    render(
      <ProjectForm
        mode="edit"
        projectId="project-1"
        labels={baseLabels}
        initialValues={{ name: "Old name", identifier: "OLD" }}
        showCancel={false}
      />,
    );

    await user.type(screen.getByLabelText("Identifier"), "1");
    await user.click(screen.getByRole("button", { name: "Save project" }));

    expect(await screen.findByText("Identifier immutable")).toBeInTheDocument();
    expect(screen.getByLabelText("Identifier")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
