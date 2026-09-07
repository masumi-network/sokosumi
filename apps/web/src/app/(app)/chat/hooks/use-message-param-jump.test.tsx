import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMessageParamJump } from "./use-message-param-jump";

interface HarnessProps {
  roomId: string | null;
  messageId: string | null;
  ready: boolean;
  jump: (messageId: string) => void;
}

function Harness(props: HarnessProps) {
  useMessageParamJump(props);
  return null;
}

describe("useMessageParamJump", () => {
  it("jumps once the room, the message and the messages are all there", () => {
    const jump = vi.fn();
    render(<Harness roomId="room-1" messageId="msg-1" ready jump={jump} />);

    expect(jump).toHaveBeenCalledExactlyOnceWith("msg-1");
  });

  it("waits for the messages before jumping", () => {
    const jump = vi.fn();
    const { rerender } = render(
      <Harness roomId="room-1" messageId="msg-1" ready={false} jump={jump} />,
    );

    expect(jump).not.toHaveBeenCalled();

    rerender(<Harness roomId="room-1" messageId="msg-1" ready jump={jump} />);

    expect(jump).toHaveBeenCalledExactlyOnceWith("msg-1");
  });

  it("does not jump again while the reader stays on the same message", () => {
    const jump = vi.fn();
    const { rerender } = render(
      <Harness roomId="room-1" messageId="msg-1" ready jump={jump} />,
    );
    // A fresh callback each render is what the room client passes.
    rerender(
      <Harness
        roomId="room-1"
        messageId="msg-1"
        ready
        jump={(id) => jump(id)}
      />,
    );

    expect(jump).toHaveBeenCalledTimes(1);
  });

  it("jumps again for a second notification in the same room", () => {
    const jump = vi.fn();
    const { rerender } = render(
      <Harness roomId="room-1" messageId="msg-1" ready jump={jump} />,
    );
    rerender(<Harness roomId="room-1" messageId="msg-2" ready jump={jump} />);

    expect(jump).toHaveBeenNthCalledWith(1, "msg-1");
    expect(jump).toHaveBeenNthCalledWith(2, "msg-2");
  });

  it("jumps again when the same message is reached in another room", () => {
    const jump = vi.fn();
    const { rerender } = render(
      <Harness roomId="room-1" messageId="msg-1" ready jump={jump} />,
    );
    rerender(<Harness roomId="room-2" messageId="msg-1" ready jump={jump} />);

    expect(jump).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no message is named", () => {
    const jump = vi.fn();
    render(<Harness roomId="room-1" messageId={null} ready jump={jump} />);

    expect(jump).not.toHaveBeenCalled();
  });

  it("does nothing before a room is selected", () => {
    const jump = vi.fn();
    render(<Harness roomId={null} messageId="msg-1" ready jump={jump} />);

    expect(jump).not.toHaveBeenCalled();
  });
  it("jumps again when the reader comes back to the same message", () => {
    const jump = vi.fn();
    const { rerender } = render(
      <Harness roomId="room-1" messageId="msg-1" ready jump={jump} />,
    );

    // Away to another room, which drops the message from the URL.
    rerender(<Harness roomId="room-2" messageId={null} ready jump={jump} />);
    // Then the same notification is clicked a second time. The room client
    // stays mounted across rooms, so this hook is the only thing that could
    // swallow it.
    rerender(<Harness roomId="room-1" messageId="msg-1" ready jump={jump} />);

    expect(jump).toHaveBeenCalledTimes(2);
  });

  it("does not jump again when the room reloads under the reader", () => {
    const jump = vi.fn();
    const { rerender } = render(
      <Harness roomId="room-1" messageId="msg-1" ready jump={jump} />,
    );

    // The reader has not gone anywhere; the room is just fetching more.
    rerender(
      <Harness roomId="room-1" messageId="msg-1" ready={false} jump={jump} />,
    );
    rerender(<Harness roomId="room-1" messageId="msg-1" ready jump={jump} />);

    expect(jump).toHaveBeenCalledTimes(1);
  });
});
