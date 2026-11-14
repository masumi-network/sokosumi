import type { Project } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProject } from "@/lib/actions/project/action";

import {
  CreateProjectModal,
  CreateProjectModalProvider,
} from "./create-project-modal";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push, replace }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/actions/project/action", () => ({ createProject: vi.fn() }));

vi.mock("@/app/projects/components/project-brand-setup", () => ({
  ProjectBrandSetup: () => <div data-testid="project-brand-setup" />,
}));

const PROJECT = { id: "p1", name: "Spring Launch" } as Project;

function renderModal(search: string) {
  window.history.replaceState(null, "", `/projects${search}`);
  render(
    <CreateProjectModalProvider initialOpen>
      <CreateProjectModal />
    </CreateProjectModalProvider>,
  );
}

const next = () =>
  userEvent.click(
    screen.getByRole("button", { name: "App.Projects.Wizard.nav.next" }),
  );

async function createThroughWizard(website?: string) {
  await userEvent.type(
    screen.getByLabelText("App.Projects.NewProject.name"),
    "Spring Launch",
  );
  if (website) {
    await userEvent.type(
      screen.getByLabelText("App.Projects.Wizard.name.websiteLabel"),
      website,
    );
  }
  await next();
  await next();
  await userEvent.click(
    screen.getByRole("button", { name: "App.Projects.Wizard.nav.create" }),
  );
  await waitFor(() => expect(createProject).toHaveBeenCalled());
}

describe("CreateProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createProject).mockResolvedValue({
      ok: true,
      value: { projectId: "p1", project: PROJECT },
    });
  });

  it("opens the new project, which the Hidden list would not show", async () => {
    renderModal("?state=hidden");

    await createThroughWizard();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/p1"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces a ?create entry with the new project, and only that", async () => {
    renderModal("?create=true&state=hidden");

    await createThroughWizard();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/projects/p1"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["Open project", "App.Projects.Wizard.nav.openProject"],
    ["Close", "Close"],
  ])(
    "leaves the brand step through %s to the new project once",
    async (_, name) => {
      renderModal("?create=true&state=hidden");

      await createThroughWizard("acme.com");
      await screen.findByTestId("project-brand-setup");
      await userEvent.click(screen.getByRole("button", { name }));

      expect(replace).toHaveBeenCalledWith("/projects/p1");
      expect(replace).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    },
  );

  it("drops ?create when the wizard is cancelled before creating", async () => {
    renderModal("?create=true&state=hidden");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(replace).toHaveBeenCalledWith("/projects?state=hidden");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });
});
