import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnreadThreadsPanel } from "@/app/chat/components/unread-threads-panel";

const countAttentionThreadsActionMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  countAttentionThreadsAction: (...args: unknown[]) =>
    countAttentionThreadsActionMock(...args),
}));

const labels = {
  open: "Threads",
};

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function renderTrigger(
  options: {
    attentionRefreshToken?: number;
    isOpen?: boolean;
    onToggle?: () => void;
  } = {},
) {
  return render(
    <UnreadThreadsPanel
      roomId={ROOM_ID}
      labels={labels}
      attentionRefreshToken={options.attentionRefreshToken ?? 0}
      isOpen={options.isOpen ?? false}
      onToggle={options.onToggle ?? vi.fn()}
    />,
  );
}

describe("UnreadThreadsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countAttentionThreadsActionMock.mockResolvedValue({
      ok: true,
      value: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a badge and toggles the thread list from the header control", async () => {
    const onToggle = vi.fn();
    renderTrigger({ onToggle });

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unread-threads-trigger"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
  });

  it("shows no badge when there are no unread threads", async () => {
    countAttentionThreadsActionMock.mockResolvedValue({ ok: true, value: 0 });

    renderTrigger();

    await waitFor(() => {
      expect(countAttentionThreadsActionMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows badge for never-looked attention threads (ADR-0005 unreadReplyCount 0)", async () => {
    countAttentionThreadsActionMock.mockResolvedValue({
      ok: true,
      value: 1,
    });

    renderTrigger();

    expect(
      await screen.findByTestId("unread-threads-badge"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${labels.open} (1)` }),
    ).toBeInTheDocument();
  });

  it("coalesces rapid attentionRefreshToken bumps into one fetch after 300ms", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={0}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    const mountCalls = countAttentionThreadsActionMock.mock.calls.length;

    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={1}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={2}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={3}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    expect(countAttentionThreadsActionMock).toHaveBeenCalledTimes(mountCalls);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(countAttentionThreadsActionMock).toHaveBeenCalledTimes(mountCalls);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(countAttentionThreadsActionMock).toHaveBeenCalledTimes(
      mountCalls + 1,
    );
  });

  it("updates badge from live refresh without opening a popover", async () => {
    countAttentionThreadsActionMock.mockResolvedValueOnce({
      ok: true,
      value: 0,
    });

    const { rerender } = render(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={0}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(countAttentionThreadsActionMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("unread-threads-badge"),
    ).not.toBeInTheDocument();

    countAttentionThreadsActionMock.mockResolvedValueOnce({
      ok: true,
      value: 2,
    });

    vi.useFakeTimers();
    rerender(
      <UnreadThreadsPanel
        roomId={ROOM_ID}
        labels={labels}
        attentionRefreshToken={1}
        isOpen={false}
        onToggle={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByTestId("unread-threads-badge")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: `${labels.open} (2)` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("unread-threads-panel"),
    ).not.toBeInTheDocument();
  });
});
