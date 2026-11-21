import type { TaskParticipant } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskMetadataParticipantsField } from "@/app/tasks/components/task-metadata-participants-field";

const {
  subscribeTaskParticipantMock,
  removeTaskParticipantMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  subscribeTaskParticipantMock: vi.fn(),
  removeTaskParticipantMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/actions/task/action", () => ({
  subscribeTaskParticipant: subscribeTaskParticipantMock,
  removeTaskParticipant: removeTaskParticipantMock,
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

const LABELS = {
  participants: "Participants",
  noParticipants: "No participants",
  joinTask: "Join task",
  leaveTask: "Leave task",
  joinError: "joinError",
  leaveError: "leaveError",
};

function participant(id: string, name: string): TaskParticipant {
  return {
    user: { id, name, image: null },
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function renderField(
  overrides: Partial<ComponentProps<typeof TaskMetadataParticipantsField>> = {},
) {
  return render(
    <TaskMetadataParticipantsField
      taskId="task-1"
      viewer={{ id: "viewer-1", name: "Viewer", image: null }}
      participants={[]}
      canJoin
      labels={LABELS}
      {...overrides}
    />,
  );
}

async function openRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Participants:/ }));
}

describe("TaskMetadataParticipantsField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribeTaskParticipantMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
    removeTaskParticipantMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1", userId: "viewer-1" },
    });
  });

  it("joins from the row and lists the viewer at once", async () => {
    const user = userEvent.setup();
    renderField({ participants: [participant("ada", "Ada")] });
    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Join task" }));
    expect(subscribeTaskParticipantMock).toHaveBeenCalledWith({
      taskId: "task-1",
    });
    expect(
      screen.getByRole("button", { name: "Participants: Ada, Viewer" }),
    ).toBeInTheDocument();
  });

  it("leaves from the row", async () => {
    const user = userEvent.setup();
    renderField({ participants: [participant("viewer-1", "Viewer")] });
    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Leave task" }));
    expect(removeTaskParticipantMock).toHaveBeenCalledWith({
      taskId: "task-1",
    });
    expect(
      screen.getByRole("button", { name: "Participants: No participants" }),
    ).toBeInTheDocument();
  });

  it("reverts and says so when joining fails", async () => {
    const user = userEvent.setup();
    subscribeTaskParticipantMock.mockResolvedValue({
      ok: false,
      error: { kind: "forbidden" },
    });
    renderField();
    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Join task" }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("joinError"),
    );
    expect(
      screen.getByRole("button", { name: "Participants: No participants" }),
    ).toBeInTheDocument();
  });

  it("reverts and says so when leaving fails", async () => {
    const user = userEvent.setup();
    removeTaskParticipantMock.mockResolvedValue({
      ok: false,
      error: { kind: "forbidden" },
    });
    renderField({ participants: [participant("viewer-1", "Viewer")] });
    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Leave task" }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("leaveError"),
    );
    expect(
      screen.getByRole("button", { name: "Participants: Viewer" }),
    ).toBeInTheDocument();
  });

  it("keeps a pending join on screen through a refresh", async () => {
    const user = userEvent.setup();
    let resolve: (value: { ok: boolean }) => void = () => {};
    subscribeTaskParticipantMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { rerender } = renderField();
    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Join task" }));
    // A refresh from before the join landed may not undo it on screen.
    rerender(
      <TaskMetadataParticipantsField
        taskId="task-1"
        viewer={{ id: "viewer-1", name: "Viewer", image: null }}
        participants={[participant("ada", "Ada")]}
        canJoin
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Participants: Viewer" }),
    ).toBeInTheDocument();
    await act(async () => resolve({ ok: true }));
  });

  it("says there are none in an open, empty row", async () => {
    const user = userEvent.setup();
    renderField({ canJoin: false });
    await openRow(user);
    expect(
      screen.getByRole("dialog", { name: "Participants" }),
    ).toHaveTextContent("No participants");
  });

  it("offers no join without comment access, but still lets a participant leave", async () => {
    const user = userEvent.setup();
    const { unmount } = renderField({ canJoin: false });
    await openRow(user);
    expect(screen.queryByRole("button", { name: "Join task" })).toBeNull();
    unmount();

    renderField({
      canJoin: false,
      participants: [participant("viewer-1", "Viewer")],
    });
    await openRow(user);
    expect(
      screen.getByRole("button", { name: "Leave task" }),
    ).toBeInTheDocument();
  });
});
