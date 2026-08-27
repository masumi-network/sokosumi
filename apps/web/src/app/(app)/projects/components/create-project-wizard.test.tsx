import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateProjectWizard } from "@/app/projects/components/create-project-wizard";
import { createProject } from "@/lib/actions/project/action";
import type { Project } from "@/lib/clients/generated/core/types.gen";

const toastErrorMock = vi.fn();
const trackMock = vi.fn();

vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

vi.mock("@/lib/actions/project/action", () => ({
  createProject: vi.fn(),
}));

vi.mock("@/app/projects/components/project-brand-setup", () => ({
  ProjectBrandSetup: ({
    onBrandChange,
  }: {
    onBrandChange?: (brand: {
      logo?: string | null;
      designMd?: { url: string; extractionId: string | null } | null;
    }) => void;
  }) => {
    useEffect(() => {
      onBrandChange?.({
        logo: "https://blob.example/logo.png",
        designMd: {
          url: "https://blob.example/DESIGN.md",
          extractionId: "ex-1",
        },
      });
    }, [onBrandChange]);
    return <div data-testid="project-brand-setup">Brand setup</div>;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      if (key === "wordCount") {
        return `${values?.count ?? 0} words`;
      }
      if (key === "chips.goals") {
        return "Goals";
      }
      const path = namespace ? `${namespace}.${key}` : key;
      if (!values) {
        return path;
      }
      return `${path}:${JSON.stringify(values)}`;
    };
  },
}));

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

describe("CreateProjectWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a name before continuing and creates with briefing", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      projectId: "project-1",
      project: CREATED_PROJECT,
    });

    render(
      <CreateProjectWizard
        open
        onOpenChange={vi.fn()}
        creationSource="projects_page"
        onSuccess={onSuccess}
      />,
    );

    const continueButton = screen.getByRole("button", {
      name: "App.Projects.Wizard.nav.next",
    });
    expect(continueButton).toBeDisabled();

    await user.type(
      screen.getByLabelText("App.Projects.NewProject.name"),
      "  Spring launch  ",
    );
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    await user.click(screen.getByTestId("briefing-chip-goals"));
    await user.type(
      screen.getByLabelText("App.Projects.Briefing.label"),
      "Win the quarter",
    );
    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.next" }),
    );

    expect(screen.getByText("Spring launch")).toBeInTheDocument();
    expect(
      screen.getByText("App.Projects.Wizard.review.contextNote"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.create" }),
    );

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "Spring launch",
        briefing: "## Goals\nWin the quarter",
        websiteUrl: null,
      });
    });
    expect(onSuccess).toHaveBeenCalledWith(
      "project-1",
      "Spring launch",
      CREATED_PROJECT,
    );
    expect(trackMock).toHaveBeenCalledWith("Project created", {
      source: "projects_page",
      variant: "wizard",
    });
  });

  it("creates with a website and stays on brand setup", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      projectId: "project-1",
      project: CREATED_PROJECT,
    });

    render(
      <CreateProjectWizard
        open
        onOpenChange={vi.fn()}
        creationSource="projects_page"
        onSuccess={onSuccess}
      />,
    );

    await user.type(
      screen.getByLabelText("App.Projects.NewProject.name"),
      "Spring launch",
    );
    await user.type(
      screen.getByLabelText("App.Projects.Wizard.name.websiteLabel"),
      "acme.com",
    );
    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.next" }),
    );
    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.next" }),
    );
    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.create" }),
    );

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "Spring launch",
        briefing: null,
        websiteUrl: "https://acme.com/",
      });
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "App.Projects.Wizard.nav.openProject",
      }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole("button", {
        name: "App.Projects.Wizard.nav.openProject",
      }),
    );
    expect(onSuccess).toHaveBeenCalledWith(
      "project-1",
      "Spring launch",
      expect.objectContaining({
        id: "project-1",
        logo: "https://blob.example/logo.png",
        designMd: {
          url: "https://blob.example/DESIGN.md",
          extractionId: "ex-1",
        },
      }),
    );
  });

  it("treats dismiss during brand setup as success", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({
      projectId: "project-1",
      project: CREATED_PROJECT,
    });

    render(
      <CreateProjectWizard
        open
        onOpenChange={onOpenChange}
        creationSource="task_form"
        onSuccess={onSuccess}
      />,
    );

    await user.type(
      screen.getByLabelText("App.Projects.NewProject.name"),
      "Spring launch",
    );
    await user.type(
      screen.getByLabelText("App.Projects.Wizard.name.websiteLabel"),
      "acme.com",
    );
    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.next" }),
    );
    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.next" }),
    );
    await user.click(
      screen.getByRole("button", { name: "App.Projects.Wizard.nav.create" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-brand-setup")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onSuccess).toHaveBeenCalledWith(
      "project-1",
      "Spring launch",
      expect.objectContaining({ id: "project-1" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
