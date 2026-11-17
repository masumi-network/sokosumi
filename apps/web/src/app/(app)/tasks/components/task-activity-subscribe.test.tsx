import type { TaskParticipant } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { type ComponentProps, type ReactNode, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskActivitySubscribeControl } from "@/app/tasks/components/task-activity-subscribe";

const {
  subscribeTaskParticipantMock,
  removeTaskParticipantMock,
  unsubscribeTaskMock,
  toastErrorMock,
  onUrlUpdateMock,
} = vi.hoisted(() => ({
  subscribeTaskParticipantMock: vi.fn(),
  removeTaskParticipantMock: vi.fn(),
  unsubscribeTaskMock: vi.fn(),
  toastErrorMock: vi.fn(),
  onUrlUpdateMock: vi.fn(),
}));

let searchParams = "";
const FOLLOW_SESSION_KEY = "sokosumi.tasks.followAfterSetup";

function UrlState({ children }: { children: ReactNode }) {
  return (
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={onUrlUpdateMock}
    >
      {children}
    </NuqsTestingAdapter>
  );
}

/** The marker after the last URL write; the start value without one. */
function followMarker() {
  const last = onUrlUpdateMock.mock.calls.at(-1)?.[0];
  return last
    ? last.searchParams.get("follow")
    : new URLSearchParams(searchParams).get("follow");
}

vi.mock("@/lib/actions/task/subscription-action", () => ({
  unsubscribeTask: unsubscribeTaskMock,
}));

vi.mock("@/lib/actions/task/action", () => ({
  subscribeTaskParticipant: subscribeTaskParticipantMock,
  removeTaskParticipant: removeTaskParticipantMock,
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.name ? `${key}:${values.name}` : key,
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: () => <div data-testid="assistant-orb" />,
}));

function participant(
  id: string,
  name: string,
  following: { subscribed?: boolean; withBot?: boolean } = {},
): TaskParticipant {
  return {
    user: { id, name, image: null },
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
    subscribedAt: following.subscribed
      ? new Date("2026-01-02T00:00:00.000Z")
      : null,
    followsWithSokoBot: following.withBot ?? false,
  };
}

const BOT = { imageUrl: "/bot.png", avatarCode: null, seed: "bot-seed" };

const follower = () =>
  participant("viewer-1", "Viewer", { subscribed: true, withBot: true });

function renderControl(
  overrides: Partial<ComponentProps<typeof TaskActivitySubscribeControl>> = {},
) {
  return render(
    <TaskActivitySubscribeControl
      taskId="task-1"
      viewerId="viewer-1"
      viewerName="Viewer"
      viewerImage={null}
      viewerSokoBot={BOT}
      participants={[]}
      canComment
      {...overrides}
    />,
    { wrapper: UrlState },
  );
}

describe("TaskActivitySubscribeControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = "";
    window.sessionStorage.clear();
    subscribeTaskParticipantMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
    removeTaskParticipantMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
    unsubscribeTaskMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
  });

  it("offers to follow with the viewer's Soko Bot", async () => {
    const user = userEvent.setup();
    renderControl();
    const button = screen.getByRole("button", { name: "followAdd" });
    // The viewer's own bot, beside the label.
    expect(button.querySelector('img[src="/bot.png"]')).not.toBeNull();
    await user.click(button);
    expect(subscribeTaskParticipantMock).toHaveBeenCalledWith({
      taskId: "task-1",
    });
  });

  it("offers to follow a participant who only was @-mentioned", () => {
    renderControl({ participants: [participant("viewer-1", "Viewer")] });
    expect(
      screen.getByRole("button", { name: "followAdd" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "followActive. unfollow" }),
    ).toBeNull();
  });

  it("stops following and keeps the viewer a participant", async () => {
    const user = userEvent.setup();
    renderControl({ participants: [follower()] });
    const active = screen.getByRole("button", {
      name: "followActive. unfollow",
    });
    expect(active.querySelector('img[src="/bot.png"]')).not.toBeNull();
    await user.click(active);
    expect(unsubscribeTaskMock).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(removeTaskParticipantMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "followAdd" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("task-subscribe-face-viewer-1"),
    ).toBeInTheDocument();
  });

  it("sends a viewer without a Soko Bot to setup, returning to this Task", () => {
    renderControl({ viewerSokoBot: null });
    expect(screen.getByRole("link", { name: "followSetup" })).toHaveAttribute(
      "href",
      `/setup/assistant?${new URLSearchParams({ next: "/tasks/task-1?follow=1" })}`,
    );
  });

  it("remembers the Task when the viewer starts setup from it", async () => {
    const user = userEvent.setup();
    renderControl({ viewerSokoBot: null });
    const link = screen.getByRole("link", { name: "followSetup" });
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBe("task-1");
  });

  it("follows once on return from setup when the bot now exists", async () => {
    searchParams = "follow=1";
    window.sessionStorage.setItem(FOLLOW_SESSION_KEY, "task-1");
    renderControl();
    await waitFor(() =>
      expect(subscribeTaskParticipantMock).toHaveBeenCalledTimes(1),
    );
    expect(followMarker()).toBeNull();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
  });

  it("follows nothing from a pasted follow link", async () => {
    searchParams = "follow=1";
    renderControl();
    await waitFor(() => expect(followMarker()).toBeNull());
    expect(subscribeTaskParticipantMock).not.toHaveBeenCalled();
  });

  it("follows nothing when setup started from another Task", async () => {
    searchParams = "follow=1";
    window.sessionStorage.setItem(FOLLOW_SESSION_KEY, "task-2");
    renderControl();
    await waitFor(() => expect(followMarker()).toBeNull());
    expect(subscribeTaskParticipantMock).not.toHaveBeenCalled();
  });

  it("follows once on return from setup, even in strict mode", async () => {
    searchParams = "follow=1";
    window.sessionStorage.setItem(FOLLOW_SESSION_KEY, "task-1");
    render(
      <StrictMode>
        <TaskActivitySubscribeControl
          taskId="task-1"
          viewerId="viewer-1"
          viewerName="Viewer"
          viewerImage={null}
          viewerSokoBot={BOT}
          participants={[]}
          canComment
        />
      </StrictMode>,
      { wrapper: UrlState },
    );
    await waitFor(() =>
      expect(subscribeTaskParticipantMock).toHaveBeenCalled(),
    );
    expect(subscribeTaskParticipantMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the hand-off while the page shows no bot, and follows once the fresh render shows it", async () => {
    searchParams = "follow=1";
    window.sessionStorage.setItem(FOLLOW_SESSION_KEY, "task-1");
    const { rerender } = renderControl({ viewerSokoBot: null });
    expect(subscribeTaskParticipantMock).not.toHaveBeenCalled();
    expect(followMarker()).toBe("1");
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBe("task-1");

    rerender(
      <TaskActivitySubscribeControl
        taskId="task-1"
        viewerId="viewer-1"
        viewerName="Viewer"
        viewerImage={null}
        viewerSokoBot={BOT}
        participants={[]}
        canComment
      />,
    );
    await waitFor(() =>
      expect(subscribeTaskParticipantMock).toHaveBeenCalledTimes(1),
    );
    expect(followMarker()).toBeNull();
  });

  it("remembers nothing when setup opens in a new tab", async () => {
    const user = userEvent.setup();
    renderControl({ viewerSokoBot: null });
    const link = screen.getByRole("link", { name: "followSetup" });
    link.addEventListener("click", (event) => event.preventDefault());
    await user.keyboard("{Meta>}");
    await user.click(link);
    await user.keyboard("{/Meta}");
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
  });

  it("offers no follow to a participant who cannot comment", () => {
    renderControl({
      canComment: false,
      participants: [participant("viewer-1", "Viewer")],
    });
    expect(screen.queryByRole("button", { name: /^follow/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sends a follower whose bot is gone to setup", () => {
    renderControl({ viewerSokoBot: null, participants: [follower()] });
    expect(
      screen.getByRole("link", { name: "followSetup" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "followActive. unfollow" }),
    ).toBeNull();
  });

  it("hides follow when the viewer cannot comment and is not a participant", () => {
    renderControl({ canComment: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the follow state when the viewer cannot comment but follows", () => {
    renderControl({ canComment: false, participants: [follower()] });
    expect(
      screen.getByRole("button", { name: "followActive. unfollow" }),
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
    expect(screen.getByTestId("task-subscribe-face-u3")).toBeInTheDocument();
    expect(screen.queryByTestId("task-subscribe-face-u4")).toBeNull();
    expect(
      screen.getByTestId("task-subscribe-face-remainder"),
    ).toHaveTextContent("+2");
  });

  it("marks the faces of people whose Soko Bot follows the Task", () => {
    renderControl({
      participants: [
        participant("u1", "Ada", { subscribed: true, withBot: true }),
        participant("u2", "Bea"),
      ],
    });
    expect(
      screen.getByTestId("task-participant-bot-mark-u1"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-participant-bot-mark-u2")).toBeNull();
  });

  it("lets a participant leave the Task from the list", async () => {
    const user = userEvent.setup();
    renderControl({
      participants: [
        participant("viewer-1", "Viewer"),
        participant("u1", "Ada"),
      ],
    });
    await user.click(screen.getByRole("button", { name: "participantsList" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Ada")).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "leaveTask" }));
    expect(removeTaskParticipantMock).toHaveBeenCalledWith({
      taskId: "task-1",
    });
  });

  it("keeps the follow state after following succeeds before the new props land", async () => {
    const user = userEvent.setup();
    let resolveSubscribe: (value: {
      ok: true;
      value: { taskId: string };
    }) => void;
    subscribeTaskParticipantMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    renderControl();
    await user.click(screen.getByRole("button", { name: "followAdd" }));
    expect(
      screen.getByRole("button", { name: "followActive. unfollow" }),
    ).toHaveAttribute("aria-busy", "true");
    resolveSubscribe!({ ok: true, value: { taskId: "task-1" } });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "followActive. unfollow" }),
      ).toBeEnabled(),
    );
  });

  it("reverts when following fails", async () => {
    const user = userEvent.setup();
    subscribeTaskParticipantMock.mockResolvedValue({
      ok: false,
      error: { kind: "forbidden" },
    });
    renderControl();
    await user.click(screen.getByRole("button", { name: "followAdd" }));
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("followError");
    });
    expect(
      screen.getByRole("button", { name: "followAdd" }),
    ).toBeInTheDocument();
  });

  it("keeps the hand-off through a render that offers no follow, and follows once it does", async () => {
    searchParams = "follow=1";
    window.sessionStorage.setItem(FOLLOW_SESSION_KEY, "task-1");
    const others = [participant("other-1", "Other")];
    const { rerender } = renderControl({
      canComment: false,
      participants: others,
    });
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBe("task-1");

    rerender(
      <TaskActivitySubscribeControl
        taskId="task-1"
        viewerId="viewer-1"
        viewerName="Viewer"
        viewerImage={null}
        viewerSokoBot={BOT}
        participants={others}
        canComment
      />,
    );
    await waitFor(() =>
      expect(subscribeTaskParticipantMock).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps a pending follow on screen through a refresh, and shows the newer list if it fails", async () => {
    const user = userEvent.setup();
    let resolveSubscribe: (value: { ok: boolean }) => void = () => {};
    subscribeTaskParticipantMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    const { rerender } = renderControl();
    await user.click(screen.getByRole("button", { name: "followAdd" }));
    const newer = [participant("other-1", "Other")];
    rerender(
      <TaskActivitySubscribeControl
        taskId="task-1"
        viewerId="viewer-1"
        viewerName="Viewer"
        viewerImage={null}
        viewerSokoBot={BOT}
        participants={newer}
        canComment
      />,
    );
    expect(
      screen.getByRole("button", { name: "followActive. unfollow" }),
    ).toBeInTheDocument();

    resolveSubscribe({ ok: false });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "followAdd" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("task-subscribe-face-other-1"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-subscribe-face-viewer-1")).toBeNull();
  });
});
