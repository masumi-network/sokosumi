import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThreadMuteButton } from "./thread-mute-button";

const getRoomThreadActionMock = vi.fn();
const setThreadMutedActionMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  getRoomThreadAction: (...args: unknown[]) => getRoomThreadActionMock(...args),
  setThreadMutedAction: (...args: unknown[]) =>
    setThreadMutedActionMock(...args),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";

function thread(mutedAt: Date | null) {
  return { ok: true as const, value: { mutedAt } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRoomThreadActionMock.mockResolvedValue(thread(null));
  setThreadMutedActionMock.mockImplementation(
    async (_roomId: string, _parentMessageId: string, muted: boolean) => ({
      ok: true as const,
      value: { mutedAt: muted ? new Date("2026-07-02T12:00:00.000Z") : null },
    }),
  );
});

const onChanged = vi.fn();

function renderButton(replyCount = 2) {
  return render(
    <ThreadMuteButton
      roomId={ROOM_ID}
      parentMessageId={PARENT_ID}
      replyCount={replyCount}
      onChanged={onChanged}
    />,
  );
}

describe("ThreadMuteButton", () => {
  it("stays hidden until the thread state is known", async () => {
    renderButton();

    expect(screen.queryByTestId("thread-panel-mute")).not.toBeInTheDocument();
    expect(await screen.findByTestId("thread-panel-mute")).toHaveAttribute(
      "aria-label",
      "mute",
    );
  });

  it("mutes an unmuted thread and answers the click at once", async () => {
    renderButton();

    fireEvent.click(await screen.findByTestId("thread-panel-mute"));

    expect(screen.getByTestId("thread-panel-mute")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => {
      expect(setThreadMutedActionMock).toHaveBeenCalledWith(
        ROOM_ID,
        PARENT_ID,
        true,
      );
    });
  });

  it("unmutes a muted thread", async () => {
    getRoomThreadActionMock.mockResolvedValue(
      thread(new Date("2026-07-02T12:00:00.000Z")),
    );

    renderButton();

    const button = await screen.findByTestId("thread-panel-mute");
    expect(button).toHaveAttribute("aria-label", "unmute");
    fireEvent.click(button);

    await waitFor(() => {
      expect(setThreadMutedActionMock).toHaveBeenCalledWith(
        ROOM_ID,
        PARENT_ID,
        false,
      );
    });
  });

  it("tells the room chrome to re-read after a write", async () => {
    renderButton();

    fireEvent.click(await screen.findByTestId("thread-panel-mute"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("reads again when the parent gains its first reply", async () => {
    getRoomThreadActionMock.mockResolvedValue({
      ok: false,
      error: { message: "not found" },
    });

    const { rerender } = renderButton(0);

    await waitFor(() => {
      expect(getRoomThreadActionMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("thread-panel-mute")).not.toBeInTheDocument();

    getRoomThreadActionMock.mockResolvedValue(thread(null));
    rerender(
      <ThreadMuteButton
        roomId={ROOM_ID}
        parentMessageId={PARENT_ID}
        replyCount={1}
        onChanged={onChanged}
      />,
    );

    expect(await screen.findByTestId("thread-panel-mute")).toBeInTheDocument();
  });

  /** The write is the truth; the optimistic value was only a guess. */
  it("settles on the state the write answered with", async () => {
    setThreadMutedActionMock.mockResolvedValue({
      ok: true as const,
      value: { mutedAt: null },
    });

    renderButton();

    fireEvent.click(await screen.findByTestId("thread-panel-mute"));

    await waitFor(() => {
      expect(screen.getByTestId("thread-panel-mute")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  it("puts the button back when the write fails", async () => {
    setThreadMutedActionMock.mockResolvedValue({
      ok: false,
      error: { message: "nope" },
    });

    renderButton();

    fireEvent.click(await screen.findByTestId("thread-panel-mute"));

    await waitFor(() => {
      expect(screen.getByTestId("thread-panel-mute")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    expect(onChanged).not.toHaveBeenCalled();
  });
});
