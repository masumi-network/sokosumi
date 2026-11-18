import type { TaskFollower } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { type ComponentProps, type ReactNode, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskFollowControl } from "@/app/tasks/components/task-follow-control";

const { followTaskMock, unfollowTaskMock, toastErrorMock, onUrlUpdateMock } =
  vi.hoisted(() => ({
    followTaskMock: vi.fn(),
    unfollowTaskMock: vi.fn(),
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

vi.mock("@/lib/actions/task/follow-action", () => ({
  followTask: followTaskMock,
  unfollowTask: unfollowTaskMock,
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function follower(id: string): TaskFollower {
  return {
    user: { id, name: id, image: null },
    followedAt: new Date("2026-01-02T00:00:00.000Z"),
    sokoBot: {
      id: `bot-${id}`,
      avatarSeed: null,
      avatarImageUrl: "/bot.png",
      avatarCode: null,
    },
  };
}

const props = (
  overrides: Partial<ComponentProps<typeof TaskFollowControl>> = {},
): ComponentProps<typeof TaskFollowControl> => ({
  taskId: "task-1",
  viewerId: "viewer-1",
  viewerHasSokoBot: true,
  followers: [],
  canComment: true,
  ...overrides,
});

function renderControl(
  overrides: Partial<ComponentProps<typeof TaskFollowControl>> = {},
) {
  return render(<TaskFollowControl {...props(overrides)} />, {
    wrapper: UrlState,
  });
}

describe("TaskFollowControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = "";
    window.sessionStorage.clear();
    followTaskMock.mockResolvedValue({ ok: true, value: { taskId: "task-1" } });
    unfollowTaskMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1" },
    });
  });

  it("follows with the viewer's Soko Bot, and shows no face of it", async () => {
    const user = userEvent.setup();
    renderControl();
    const button = screen.getByRole("button", { name: "follow" });
    expect(button.querySelector("img, canvas")).toBeNull();
    await user.click(button);
    expect(followTaskMock).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(
      screen.getByRole("button", { name: "followActive. unfollow" }),
    ).toBeInTheDocument();
  });

  it("stops following", async () => {
    const user = userEvent.setup();
    renderControl({ followers: [follower("viewer-1")] });
    await user.click(
      screen.getByRole("button", { name: "followActive. unfollow" }),
    );
    expect(unfollowTaskMock).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(screen.getByRole("button", { name: "follow" })).toBeInTheDocument();
  });

  it("reads another person's follow as not the viewer's", () => {
    renderControl({ followers: [follower("other-1")] });
    expect(screen.getByRole("button", { name: "follow" })).toBeInTheDocument();
  });

  it("reverts and says so when following fails", async () => {
    const user = userEvent.setup();
    followTaskMock.mockResolvedValue({
      ok: false,
      error: { kind: "conflict" },
    });
    renderControl();
    await user.click(screen.getByRole("button", { name: "follow" }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("followError"),
    );
    expect(screen.getByRole("button", { name: "follow" })).toBeInTheDocument();
  });

  it("keeps a pending follow on screen through a refresh", async () => {
    const user = userEvent.setup();
    let resolve: (value: { ok: boolean }) => void = () => {};
    followTaskMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { rerender } = renderControl();
    await user.click(screen.getByRole("button", { name: "follow" }));
    // A refresh from before the follow landed, then one from after a later
    // unfollow elsewhere: neither may undo the pending follow on screen.
    rerender(
      <TaskFollowControl {...props({ followers: [follower("viewer-1")] })} />,
    );
    rerender(<TaskFollowControl {...props({ followers: [] })} />);
    expect(
      screen.getByRole("button", { name: "followActive. unfollow" }),
    ).toBeInTheDocument();
    resolve({ ok: true });
  });

  it("sends a viewer without a Soko Bot to setup, returning to this Task", () => {
    renderControl({ viewerHasSokoBot: false });
    expect(screen.getByRole("link", { name: "follow" })).toHaveAttribute(
      "href",
      `/setup/assistant?${new URLSearchParams({ next: "/tasks/task-1?follow=1" })}`,
    );
  });

  it("remembers the Task when setup starts here, but not in a new tab", async () => {
    const user = userEvent.setup();
    renderControl({ viewerHasSokoBot: false });
    const link = screen.getByRole("link", { name: "follow" });
    link.addEventListener("click", (event) => event.preventDefault());
    await user.keyboard("{Meta>}");
    await user.click(link);
    await user.keyboard("{/Meta}");
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
    await user.click(link);
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBe("task-1");
  });

  it("follows once on return from setup, even in strict mode", async () => {
    searchParams = "follow=1";
    window.sessionStorage.setItem(FOLLOW_SESSION_KEY, "task-1");
    render(
      <StrictMode>
        <TaskFollowControl {...props()} />
      </StrictMode>,
      { wrapper: UrlState },
    );
    await waitFor(() => expect(followTaskMock).toHaveBeenCalled());
    expect(followTaskMock).toHaveBeenCalledTimes(1);
    expect(followMarker()).toBeNull();
    expect(window.sessionStorage.getItem(FOLLOW_SESSION_KEY)).toBeNull();
  });

  it.each([
    ["a pasted follow link", null],
    ["a setup started from another Task", "task-2"],
  ])("follows nothing from %s", async (_case, stored) => {
    searchParams = "follow=1";
    if (stored) window.sessionStorage.setItem(FOLLOW_SESSION_KEY, stored);
    renderControl();
    await waitFor(() => expect(followMarker()).toBeNull());
    expect(followTaskMock).not.toHaveBeenCalled();
  });

  it("keeps the hand-off while the page shows no bot, and follows once it does", async () => {
    searchParams = "follow=1";
    window.sessionStorage.setItem(FOLLOW_SESSION_KEY, "task-1");
    const { rerender } = renderControl({ viewerHasSokoBot: false });
    expect(followTaskMock).not.toHaveBeenCalled();
    expect(followMarker()).toBe("1");

    rerender(<TaskFollowControl {...props()} />);
    await waitFor(() => expect(followTaskMock).toHaveBeenCalledTimes(1));
    expect(followMarker()).toBeNull();
  });

  it("hides follow from a viewer who cannot comment, but keeps their own follow", () => {
    const { rerender } = renderControl({ canComment: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(
      <TaskFollowControl
        {...props({ canComment: false, followers: [follower("viewer-1")] })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "followActive. unfollow" }),
    ).toBeInTheDocument();
  });

  it("lets a follower whose bot is gone stop following", async () => {
    const user = userEvent.setup();
    renderControl({
      viewerHasSokoBot: false,
      followers: [follower("viewer-1")],
    });
    await user.click(
      screen.getByRole("button", { name: "followActive. unfollow" }),
    );
    expect(unfollowTaskMock).toHaveBeenCalledWith({ taskId: "task-1" });
  });
});
