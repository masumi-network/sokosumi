import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";

const { closeProjectMock, deleteProjectMock, refreshMock, toastErrorMock } =
  vi.hoisted(() => ({
    closeProjectMock: vi.fn(),
    deleteProjectMock: vi.fn(),
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
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
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/project/action", () => ({
  closeProject: closeProjectMock,
  deleteProject: deleteProjectMock,
}));

const LABELS = {
  moreActions: "More actions",
  edit: "Edit",
  close: "Close project",
  delete: "Delete",
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
  deleteDialog: {
    title: "Delete project?",
    description: "This cannot be undone.",
    confirm: "Delete",
    cancel: "Cancel",
    error: "Failed to delete",
  },
};

describe("ProjectDetailActions", () => {
  beforeEach(() => {
    closeProjectMock.mockReset();
    deleteProjectMock.mockReset();
    refreshMock.mockReset();
    toastErrorMock.mockReset();
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
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
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

  it("reuses the Project deletion identity only while retrying one intent", async () => {
    const user = userEvent.setup();
    deleteProjectMock.mockRejectedValue(new Error("delete failed"));
    render(<ProjectDetailActions projectId="project-1" labels={LABELS} />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    await user.click(deleteButton);
    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledTimes(1));
    await user.click(deleteButton);
    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledTimes(2));

    const firstOperationId = deleteProjectMock.mock.calls[0]?.[0].operationId;
    expect(firstOperationId).toMatch(/[0-9a-f-]{36}/);
    expect(deleteProjectMock.mock.calls[1]?.[0]).toEqual({
      projectId: "project-1",
      operationId: firstOperationId,
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledTimes(3));
    expect(deleteProjectMock.mock.calls[2]?.[0].operationId).not.toBe(
      firstOperationId,
    );
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
});
