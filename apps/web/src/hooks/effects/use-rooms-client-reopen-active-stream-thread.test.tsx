import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useRoomsClientReopenActiveStreamThread } from "./use-rooms-client-reopen-active-stream-thread";

const ROOM = { id: "room-1" } as ChatRoom;
const PARENT = { id: "parent-1" } as ChatRoomMessage;
const OTHER = { id: "parent-2" } as ChatRoomMessage;

describe("useRoomsClientReopenActiveStreamThread", () => {
  it("loads the active stream thread when guards pass and skips when already open or missing", () => {
    const loadThreadMessages = vi.fn();
    const messages = [PARENT, OTHER];

    function Probe({
      isCoworkerStreamRoom = true,
      selectedRoom = ROOM as ChatRoom | null,
      activeStreamParentMessageId = "parent-1" as string | null,
      threadParentMessage = null as ChatRoomMessage | null,
      topLevelRoomMessages = messages,
      onLoad = loadThreadMessages,
    }: {
      isCoworkerStreamRoom?: boolean;
      selectedRoom?: ChatRoom | null;
      activeStreamParentMessageId?: string | null;
      threadParentMessage?: ChatRoomMessage | null;
      topLevelRoomMessages?: ChatRoomMessage[];
      onLoad?: (parent: ChatRoomMessage) => void;
    }) {
      useRoomsClientReopenActiveStreamThread({
        isCoworkerStreamRoom,
        selectedRoom,
        activeStreamParentMessageId,
        threadParentMessage,
        topLevelRoomMessages,
        loadThreadMessages: onLoad,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <Probe isCoworkerStreamRoom={false} />,
    );
    expect(loadThreadMessages).not.toHaveBeenCalled();

    rerender(<Probe selectedRoom={null} />);
    expect(loadThreadMessages).not.toHaveBeenCalled();

    rerender(<Probe activeStreamParentMessageId={null} />);
    expect(loadThreadMessages).not.toHaveBeenCalled();

    rerender(<Probe activeStreamParentMessageId="missing" />);
    expect(loadThreadMessages).not.toHaveBeenCalled();

    rerender(<Probe threadParentMessage={PARENT} />);
    expect(loadThreadMessages).not.toHaveBeenCalled();

    rerender(<Probe threadParentMessage={null} />);
    expect(loadThreadMessages).toHaveBeenCalledExactlyOnceWith(PARENT);

    // Changing only loadThreadMessages identity does not re-trigger (exact 5-dep parity).
    const nextLoad = vi.fn();
    rerender(<Probe threadParentMessage={null} onLoad={nextLoad} />);
    expect(nextLoad).not.toHaveBeenCalled();
    expect(loadThreadMessages).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal calls", () => {
    const loadThreadMessages = vi.fn();
    const messages = [PARENT];

    function Probe() {
      useRoomsClientReopenActiveStreamThread({
        isCoworkerStreamRoom: true,
        selectedRoom: ROOM,
        activeStreamParentMessageId: "parent-1",
        threadParentMessage: null,
        topLevelRoomMessages: messages,
        loadThreadMessages,
      });
      return null;
    }

    const strict = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(loadThreadMessages).toHaveBeenCalledTimes(2);
    strict.unmount();

    loadThreadMessages.mockClear();
    const activity = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(loadThreadMessages).toHaveBeenCalledTimes(1);

    activity.rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    expect(loadThreadMessages).toHaveBeenCalledTimes(1);

    activity.rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(loadThreadMessages).toHaveBeenCalledTimes(2);
    activity.unmount();
  });
});
