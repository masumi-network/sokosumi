import type { TaskEvent } from "@sokosumi/core-client";
import { act, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_ACTIVITY_MESSAGE_LIST } from "@/app/tasks/utils/task-activity-feed";

const highlightListMessageMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/chat/utils/room-message-highlight", () => ({
  highlightListMessage: highlightListMessageMock,
}));

import { useTaskActivityJumpHighlight } from "./use-task-activity-jump-highlight";

function makeEvent(id: string): TaskEvent {
  return { id } as unknown as TaskEvent;
}

describe("useTaskActivityJumpHighlight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries highlighting on feed dependency changes until highlightListMessage succeeds, then clears pending id", () => {
    highlightListMessageMock.mockReturnValue(false);
    let scheduleJump: ((eventId: string) => void) | null = null;

    function Probe({
      localEvents,
      commentsExpanded,
      feedItems,
    }: {
      localEvents: TaskEvent[];
      commentsExpanded: boolean;
      feedItems: readonly unknown[];
    }) {
      scheduleJump = useTaskActivityJumpHighlight(
        localEvents,
        commentsExpanded,
        feedItems,
      );
      return null;
    }

    const events1 = [makeEvent("e1")];
    const items1 = [{ id: "e1" }];
    const { rerender, unmount } = render(
      <Probe
        localEvents={events1}
        commentsExpanded={false}
        feedItems={items1}
      />,
    );
    expect(highlightListMessageMock).not.toHaveBeenCalled();

    act(() => {
      scheduleJump?.("e2");
    });
    expect(highlightListMessageMock).toHaveBeenCalledTimes(1);
    expect(highlightListMessageMock).toHaveBeenLastCalledWith(
      TASK_ACTIVITY_MESSAGE_LIST,
      "e2",
    );

    const events2 = [makeEvent("e1"), makeEvent("e2")];
    rerender(
      <Probe
        localEvents={events2}
        commentsExpanded={false}
        feedItems={items1}
      />,
    );
    expect(highlightListMessageMock).toHaveBeenCalledTimes(2);

    rerender(
      <Probe
        localEvents={events2}
        commentsExpanded={true}
        feedItems={items1}
      />,
    );
    expect(highlightListMessageMock).toHaveBeenCalledTimes(3);

    highlightListMessageMock.mockReturnValue(true);
    const items2 = [{ id: "e1" }, { id: "e2" }];
    rerender(
      <Probe
        localEvents={events2}
        commentsExpanded={true}
        feedItems={items2}
      />,
    );
    expect(highlightListMessageMock).toHaveBeenCalledTimes(4);

    // Once highlighted, pendingJumpId is cleared so later updates do not re-highlight.
    rerender(
      <Probe
        localEvents={[...events2, makeEvent("e3")]}
        commentsExpanded={true}
        feedItems={[...items2, { id: "e3" }]}
      />,
    );
    expect(highlightListMessageMock).toHaveBeenCalledTimes(4);

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal while a jump is pending", () => {
    highlightListMessageMock.mockReturnValue(false);
    let scheduleJump: ((eventId: string) => void) | null = null;

    function Probe({
      localEvents,
      commentsExpanded,
      feedItems,
    }: {
      localEvents: TaskEvent[];
      commentsExpanded: boolean;
      feedItems: readonly unknown[];
    }) {
      scheduleJump = useTaskActivityJumpHighlight(
        localEvents,
        commentsExpanded,
        feedItems,
      );
      return null;
    }

    const events = [makeEvent("e1")];
    const items = [{ id: "e1" }];
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe
            localEvents={events}
            commentsExpanded={false}
            feedItems={items}
          />
        </Activity>
      </StrictMode>,
    );
    expect(highlightListMessageMock).not.toHaveBeenCalled();

    act(() => {
      scheduleJump?.("e2");
    });
    expect(highlightListMessageMock).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe
            localEvents={events}
            commentsExpanded={false}
            feedItems={items}
          />
        </Activity>
      </StrictMode>,
    );
    expect(highlightListMessageMock).toHaveBeenCalledTimes(1);

    highlightListMessageMock.mockReturnValue(true);
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe
            localEvents={events}
            commentsExpanded={false}
            feedItems={items}
          />
        </Activity>
      </StrictMode>,
    );
    // StrictMode replays the reveal effect with the same pendingJumpId closure.
    expect(highlightListMessageMock).toHaveBeenCalledTimes(3);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe
            localEvents={[...events, makeEvent("e2")]}
            commentsExpanded={true}
            feedItems={[...items, { id: "e2" }]}
          />
        </Activity>
      </StrictMode>,
    );
    expect(highlightListMessageMock).toHaveBeenCalledTimes(3);

    unmount();
  });
});
