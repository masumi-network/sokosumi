import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";

const {
  closeProjectMock,
  refreshMock,
  toastErrorMock,
  toastSuccessMock,
  hideProjectActionMock,
  showProjectActionMock,
  pinProjectActionMock,
} = vi.hoisted(() => ({
  closeProjectMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  hideProjectActionMock: vi.fn(),
  showProjectActionMock: vi.fn(),
  pinProjectActionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: refreshMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@/lib/actions/project/action", () => ({
  closeProject: closeProjectMock,
}));

vi.mock("@/app/projects/actions", () => ({
  hideProjectAction: hideProjectActionMock,
  showProjectAction: showProjectActionMock,
  pinProjectAction: pinProjectActionMock,
}));

const LABELS = {
  moreActions: "More actions",
  edit: "Edit",
  close: "Close project",
  hide: {
    hide: "Hide project",
    show: "Show project",
    hidden: "Project hidden",
    undo: "Undo",
    hideError: "Could not hide",
    showError: "Could not show",
  },
  closeDialog: {
    title: "Close project?",
    description: "Scheduled work will be resolved before closing.",
    reasonLabel: "Reason (optional)",
    reasonPlaceholder: "Why is this project closing?",
    confirm: "Close project",
    cancel: "Keep project open",
    success: "Project close started",
    error: "Unable to close project",
  },
};

describe("ProjectDetailActions", () => {
  beforeEach(() => {
    closeProjectMock.mockReset();
    refreshMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    hideProjectActionMock.mockReset();
    showProjectActionMock.mockReset();
    pinProjectActionMock.mockReset();
  });

  it("hides the project with an Undo that shows and re-Pins it", async () => {
    const user = userEvent.setup();
    hideProjectActionMock.mockResolvedValue({ unpinned: true });
    showProjectActionMock.mockResolvedValue({});
    pinProjectActionMock.mockResolvedValue({});
    render(<ProjectDetailActions projectId="project-1" labels={LABELS} />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Hide project" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    expect(hideProjectActionMock).toHaveBeenCalledWith({
      projectId: "project-1",
    });
    expect(refreshMock).toHaveBeenCalled();
    const [message, options] = toastSuccessMock.mock.calls[0];
    expect(message).toBe("Project hidden");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();

    await waitFor(() =>
      expect(pinProjectActionMock).toHaveBeenCalledWith({
        projectId: "project-1",
      }),
    );
    expect(showProjectActionMock).toHaveBeenCalledWith({
      projectId: "project-1",
    });
  });

  it("offers Show, not Hide, for a project the reader has Hidden", async () => {
    const user = userEvent.setup();
    showProjectActionMock.mockResolvedValue({});
    render(
      <ProjectDetailActions projectId="project-1" isHidden labels={LABELS} />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.queryByRole("menuitem", { name: "Hide project" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Show project" }));

    await waitFor(() =>
      expect(showProjectActionMock).toHaveBeenCalledWith({
        projectId: "project-1",
      }),
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("exposes project actions only inside the overflow menu", async () => {
    const user = userEvent.setup();

    render(<ProjectDetailActions projectId="project-1" labels={LABELS} />);

    expect(
      screen.queryByRole("link", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Close project" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions" }));

    const editLink = screen.getByRole("menuitem", { name: "Edit" });
    expect(editLink).toHaveAttribute("href", "/projects/project-1/edit");
    expect(
      screen.queryByRole("menuitem", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("starts a revision-safe close from a destructive confirmation", async () => {
    const user = userEvent.setup();
    closeProjectMock.mockResolvedValue({});
    render(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={3}
        labels={LABELS}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Close project" }));
    expect(
      screen.getByRole("alertdialog", { name: "Close project?" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Reason (optional)" }),
      "Campaign complete",
    );
    await user.click(screen.getByRole("button", { name: "Close project" }));

    expect(closeProjectMock).toHaveBeenCalledWith({
      projectId: "project-1",
      operationId: expect.stringMatching(/[0-9a-f-]{36}/),
      expectedProjectRevision: 3,
      reason: "Campaign complete",
    });
  });

  it("does not offer close after closing has started", async () => {
    const user = userEvent.setup();
    render(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={4}
        isClosingOrClosed
        labels={LABELS}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));

    expect(
      screen.queryByRole("menuitem", { name: "Close project" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("closes an open confirmation when the authoritative project starts closing", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={4}
        labels={LABELS}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Close project" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    rerender(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={5}
        isClosingOrClosed
        labels={LABELS}
      />,
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reuses an operation ID only when retrying the same close payload", async () => {
    const user = userEvent.setup();
    closeProjectMock.mockRejectedValue(new Error("close failed"));
    const { rerender } = render(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={3}
        labels={LABELS}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Close project" }));
    const reason = screen.getByRole("textbox", { name: "Reason (optional)" });
    await user.type(reason, "Campaign complete");
    const closeButton = screen.getByRole("button", { name: "Close project" });

    await user.click(closeButton);
    await vi.waitFor(() => expect(closeProjectMock).toHaveBeenCalledTimes(1));
    rerender(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={4}
        labels={LABELS}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close project" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Close project" }));
    await vi.waitFor(() => expect(closeProjectMock).toHaveBeenCalledTimes(2));

    const firstOperationId = closeProjectMock.mock.calls[0]?.[0].operationId;
    expect(closeProjectMock.mock.calls[1]?.[0].operationId).toBe(
      firstOperationId,
    );
    expect(closeProjectMock.mock.calls[1]?.[0].expectedProjectRevision).toBe(4);

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Reason (optional)" }),
      ).toBeEnabled(),
    );
    const updatedReason = screen.getByRole("textbox", {
      name: "Reason (optional)",
    });
    await user.clear(updatedReason);
    await user.type(updatedReason, "Scope changed");
    await user.click(screen.getByRole("button", { name: "Close project" }));
    await vi.waitFor(() => expect(closeProjectMock).toHaveBeenCalledTimes(3));

    expect(closeProjectMock.mock.calls[2]?.[0].operationId).not.toBe(
      firstOperationId,
    );
    expect(refreshMock).toHaveBeenCalledTimes(3);
    expect(toastErrorMock).toHaveBeenLastCalledWith(LABELS.closeDialog.error, {
      duration: Infinity,
    });
  });

  it("warns how many scheduled posts close will cancel", async () => {
    const user = userEvent.setup();
    render(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={3}
        labels={{
          ...LABELS,
          closeDialog: {
            ...LABELS.closeDialog,
            scheduledPostsWarning: "3 scheduled posts will be canceled.",
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Close project" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "3 scheduled posts will be canceled.",
    );
  });

  it("adds no scheduled-post warning when none will be canceled", async () => {
    const user = userEvent.setup();
    render(
      <ProjectDetailActions
        projectId="project-1"
        projectRevision={3}
        labels={LABELS}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Close project" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByText("Scheduled work will be resolved before closing."),
    ).toBeInTheDocument();
  });
});
