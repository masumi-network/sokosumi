import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateProjectWizard } from "@/app/projects/components/create-project-wizard";
import { createProject } from "@/lib/actions/project/action";

const toastErrorMock = vi.fn();
const trackMock = vi.fn();

vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

vi.mock("@/lib/actions/project/action", () => ({
  createProject: vi.fn(),
}));

vi.mock("@/app/projects/components/project-brand-setup", () => ({
  ProjectBrandSetup: () => (
    <div data-testid="project-brand-setup">Brand setup</div>
  ),
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

describe("CreateProjectWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a name before continuing and creates with briefing", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({ projectId: "project-1" });

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
    expect(onSuccess).toHaveBeenCalledWith("project-1", "Spring launch");
    expect(trackMock).toHaveBeenCalledWith("Project created", {
      source: "projects_page",
      variant: "wizard",
    });
  });

  it("creates with a website and stays on brand setup", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const createProjectMock = vi.mocked(createProject);
    createProjectMock.mockResolvedValue({ projectId: "project-1" });

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
  });
});
