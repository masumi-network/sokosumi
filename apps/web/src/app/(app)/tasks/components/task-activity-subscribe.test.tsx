import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskActivitySubscribeControl } from "@/app/tasks/components/task-activity-subscribe";
import type { TaskParticipant } from "@/lib/clients/generated/core/types.gen";

const { subscribeTaskParticipantMock, removeTaskParticipantMock, refreshMock } =
  vi.hoisted(() => ({
    subscribeTaskParticipantMock: vi.fn(),
    removeTaskParticipantMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/actions/task/action", () => ({
  subscribeTaskParticipant: subscribeTaskParticipantMock,
  removeTaskParticipant: removeTaskParticipantMock,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.name ? `${key}:${values.name}` : key,
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: () => <div data-testid="assistant-orb" />,
}));

function participant(id: string, name: string): TaskParticipant {
  return {
    user: { id, name, image: null },
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function renderControl(
  overrides: Partial<ComponentProps<typeof TaskActivitySubscribeControl>> = {},
) {
  return render(
    <TaskActivitySubscribeControl
      taskId="task-1"
      viewerId="viewer-1"
      viewerName="Viewer"
      viewerImage={null}
      participants={[]}
      canComment
      {...overrides}
    />,
  );
}

describe("TaskActivitySubscribeControl", () => {
  beforeEach(() => {
    subscribeTaskParticipantMock.mockReset();
    removeTaskParticipantMock.mockReset();
    refreshMock.mockReset();
    subscribeTaskParticipantMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
    removeTaskParticipantMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1", userId: "viewer-1" },
    });
  });

  it("shows Subscribe when the viewer is not a participant", () => {
    renderControl();
    expect(
      screen.getByRole("button", { name: "subscribe" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "unsubscribe" })).toBeNull();
  });

  it("shows Unsubscribe when the viewer is a participant", () => {
    renderControl({
      participants: [participant("viewer-1", "Viewer")],
    });
    expect(
      screen.getByRole("button", { name: "unsubscribe" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "subscribe" })).toBeNull();
  });

  it("hides Subscribe when the viewer cannot comment and is not a participant", () => {
    renderControl({ canComment: false });
    expect(screen.queryByRole("button", { name: "subscribe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "unsubscribe" })).toBeNull();
  });

  it("keeps Unsubscribe when the viewer cannot comment but is a participant", () => {
    renderControl({
      canComment: false,
      participants: [participant("viewer-1", "Viewer")],
    });
    expect(
      screen.getByRole("button", { name: "unsubscribe" }),
    ).toBeInTheDocument();
  });

  it("shows three faces and +2 for five participants", () => {
    renderControl({
      participants: [
        participant("u1", "Ada"),
        participant("u2", "Bea"),
        participant("u3", "Cara"),
        participant("u4", "Dee"),
        participant("u5", "Eve"),
      ],
    });
    expect(screen.getByTestId("task-subscribe-face-u1")).toBeInTheDocument();
    expect(screen.getByTestId("task-subscribe-face-u2")).toBeInTheDocument();
    expect(screen.getByTestId("task-subscribe-face-u3")).toBeInTheDocument();
    expect(screen.queryByTestId("task-subscribe-face-u4")).toBeNull();
    const remainder = screen.getByTestId("task-subscribe-face-remainder");
    expect(remainder).toHaveTextContent("+2");
    // Last face used to sit above +N (z-index 0) and hide the plus.
    expect(Number(remainder.style.zIndex)).toBeGreaterThan(
      Number(screen.getByTestId("task-subscribe-face-u3").style.zIndex),
    );
  });

  it("omits the remainder when there are three or fewer participants", () => {
    renderControl({
      participants: [
        participant("u1", "Ada"),
        participant("u2", "Bea"),
        participant("u3", "Cara"),
      ],
    });
    expect(screen.queryByTestId("task-subscribe-face-remainder")).toBeNull();
  });

  it("lists every participant in the dropdown", async () => {
    const user = userEvent.setup();
    renderControl({
      participants: [
        participant("u1", "Ada"),
        participant("u2", "Bea"),
        participant("u3", "Cara"),
        participant("u4", "Dee"),
      ],
    });
    await user.click(screen.getByRole("button", { name: "participantsList" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Ada")).toBeInTheDocument();
    expect(within(menu).getByText("Bea")).toBeInTheDocument();
    expect(within(menu).getByText("Cara")).toBeInTheDocument();
    expect(within(menu).getByText("Dee")).toBeInTheDocument();
    expect(
      within(menu).queryByRole("button", { name: /^removeParticipant:/ }),
    ).toBeNull();
  });

  it("subscribes the viewer when Subscribe is pressed", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "subscribe" }));
    expect(subscribeTaskParticipantMock).toHaveBeenCalledWith({
      taskId: "task-1",
    });
  });

  it("unsubscribes the viewer when Unsubscribe is pressed", async () => {
    const user = userEvent.setup();
    renderControl({
      participants: [participant("viewer-1", "Viewer")],
    });
    await user.click(screen.getByRole("button", { name: "unsubscribe" }));
    expect(removeTaskParticipantMock).toHaveBeenCalledWith({
      taskId: "task-1",
      userId: "viewer-1",
    });
  });
});
