import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideProjectAction,
  pinProjectAction,
  showProjectAction,
} from "@/app/projects/actions";
import { ProjectCardMenu } from "@/app/projects/components/project-card-menu";

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/app/projects/actions", () => ({
  hideProjectAction: vi.fn(),
  showProjectAction: vi.fn(),
  pinProjectAction: vi.fn(),
}));

const labels = {
  moreActions: "More actions",
  hide: "Hide project",
  show: "Show project",
  hidden: "Project hidden",
  undo: "Undo",
  hideError: "Could not hide",
  showError: "Could not show",
};

async function choose(item: string, hidden = false) {
  const onHiddenChange = vi.fn();
  const user = userEvent.setup();
  render(
    <ProjectCardMenu
      projectId="project-1"
      hidden={hidden}
      labels={labels}
      onHiddenChange={onHiddenChange}
    />,
  );
  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
  return onHiddenChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(showProjectAction).mockResolvedValue({
    projectId: "project-1",
    hiddenAt: null,
  });
});

describe("ProjectCardMenu", () => {
  it("hides the project and offers Undo, which shows it again", async () => {
    vi.mocked(hideProjectAction).mockResolvedValue({
      projectId: "project-1",
      hiddenAt: new Date(),
      unpinned: false,
    });

    const onHiddenChange = await choose("Hide project");

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(onHiddenChange).toHaveBeenCalledOnce();
    const [message, options] = toastMock.success.mock.calls[0];
    expect(message).toBe("Project hidden");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();

    await waitFor(() => expect(onHiddenChange).toHaveBeenCalledTimes(2));
    expect(showProjectAction).toHaveBeenCalledWith({ projectId: "project-1" });
    // Nothing was Pinned, so Undo Pins nothing.
    expect(pinProjectAction).not.toHaveBeenCalled();
  });

  it("re-Pins on Undo when the Hide removed a Pin", async () => {
    vi.mocked(hideProjectAction).mockResolvedValue({
      projectId: "project-1",
      hiddenAt: new Date(),
      unpinned: true,
    });

    await choose("Hide project");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    toastMock.success.mock.calls[0][1].action.onClick();

    await waitFor(() =>
      expect(pinProjectAction).toHaveBeenCalledWith({ projectId: "project-1" }),
    );
  });

  it("says so when the Hide fails, and offers no Undo", async () => {
    vi.mocked(hideProjectAction).mockRejectedValue(new Error("down"));

    const onHiddenChange = await choose("Hide project");

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Could not hide"),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onHiddenChange).not.toHaveBeenCalled();
  });

  it("shows a Hidden project from the Hidden view", async () => {
    const onHiddenChange = await choose("Show project", true);

    await waitFor(() => expect(onHiddenChange).toHaveBeenCalledOnce());
    expect(showProjectAction).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(hideProjectAction).not.toHaveBeenCalled();
  });
});
