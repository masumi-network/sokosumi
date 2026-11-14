import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./create-project-wizard", () => ({
  CreateProjectWizard: ({
    onSuccess,
  }: {
    onSuccess: (projectId: string, name: string) => void;
  }) => (
    <button type="button" onClick={() => onSuccess("p1", "Spring Launch")}>
      Create project
    </button>
  ),
}));

function renderModal() {
  render(
    <CreateProjectModalProvider initialOpen>
      <CreateProjectModal />
    </CreateProjectModalProvider>,
  );
}

describe("CreateProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/projects?state=hidden");
  });

  it("opens the new project, which the Hidden or Closed list would not show", async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole("button", { name: "Create project" }),
    );

    expect(push).toHaveBeenCalledWith("/projects/p1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces a ?create entry so Back does not reopen the wizard", async () => {
    window.history.replaceState(null, "", "/projects?create=true");
    renderModal();

    await userEvent.click(
      screen.getByRole("button", { name: "Create project" }),
    );

    expect(replace).toHaveBeenCalledWith("/projects/p1");
    expect(push).not.toHaveBeenCalled();
  });
});
