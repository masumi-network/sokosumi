import { render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { useCoworkerStreamRoomReconnect } from "./use-coworker-stream-room-reconnect";

function Probe({
  roomId,
  resumeStream,
  setMessages,
}: {
  roomId: string | null;
  resumeStream: () => Promise<void>;
  setMessages: (messages: UIMessage[]) => void;
}) {
  useCoworkerStreamRoomReconnect(roomId, resumeStream, setMessages);
  return null;
}

describe("useCoworkerStreamRoomReconnect", () => {
  it("clears messages when leaving a room and resumes the stream when entering or switching rooms", () => {
    const resumeStream = vi.fn(async () => {});
    const setMessages = vi.fn();

    const { rerender, unmount } = render(
      <Probe
        roomId={null}
        resumeStream={resumeStream}
        setMessages={setMessages}
      />,
    );
    expect(setMessages).toHaveBeenCalledExactlyOnceWith([]);
    expect(resumeStream).not.toHaveBeenCalled();

    rerender(
      <Probe
        roomId="room-1"
        resumeStream={resumeStream}
        setMessages={setMessages}
      />,
    );
    expect(resumeStream).toHaveBeenCalledTimes(1);

    rerender(
      <Probe
        roomId="room-2"
        resumeStream={resumeStream}
        setMessages={setMessages}
      />,
    );
    expect(resumeStream).toHaveBeenCalledTimes(2);

    unmount();
  });
});
