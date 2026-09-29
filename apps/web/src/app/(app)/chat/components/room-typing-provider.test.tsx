import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useRoomTypingMock = vi.fn();

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/ably/use-room-typing", () => ({
  useRoomTyping: (...args: unknown[]) => useRoomTypingMock(...args),
}));

import {
  RoomTypingProvider,
  useRoomTypingContext,
} from "./room-typing-provider";

function Consumer() {
  const { enabled, typistIds } = useRoomTypingContext();
  return (
    <span data-testid="consumer">{`${enabled}:${typistIds.join(",")}`}</span>
  );
}

describe("RoomTypingProvider", () => {
  beforeEach(() => {
    useRoomTypingMock.mockReset();
  });

  it("stays inert outside a provider, so the Thread composer says nothing", () => {
    render(<Consumer />);

    expect(screen.getByTestId("consumer")).toHaveTextContent("false:");
    expect(useRoomTypingMock).not.toHaveBeenCalled();
  });

  it("reports the room's typists to whatever it wraps", () => {
    useRoomTypingMock.mockReturnValue({
      typistIds: ["user_pat"],
      handleComposerChange: vi.fn(),
      handleStopTyping: vi.fn(),
    });

    render(
      <RoomTypingProvider roomId="room-a" currentUserId="user_me">
        <Consumer />
      </RoomTypingProvider>,
    );

    expect(screen.getByTestId("consumer")).toHaveTextContent("true:user_pat");
    expect(useRoomTypingMock).toHaveBeenCalledWith("room-a", "user_me");
  });

  it("settles when the room hands it a fresh array of the same people", () => {
    // The island reports upward from an effect keyed on the list it was given.
    // A caller returning an equal-but-new array each render must not drive
    // report → setState → re-render → report forever: that loop pegged a CPU
    // for minutes and aborted the worker.
    let renders = 0;
    useRoomTypingMock.mockImplementation(() => {
      renders += 1;
      return {
        typistIds: ["user_pat"],
        handleComposerChange: () => {},
        handleStopTyping: () => {},
      };
    });

    render(
      <RoomTypingProvider roomId="room-a" currentUserId="user_me">
        <Consumer />
      </RoomTypingProvider>,
    );

    expect(screen.getByTestId("consumer")).toHaveTextContent("true:user_pat");
    // A handful of renders is normal; an unbounded loop is not.
    expect(renders).toBeLessThan(10);
  });

  it("waits for a signed-in reader before touching Ably", () => {
    render(
      <RoomTypingProvider roomId="room-a" currentUserId={null}>
        <Consumer />
      </RoomTypingProvider>,
    );

    expect(screen.getByTestId("consumer")).toHaveTextContent("true:");
    expect(useRoomTypingMock).not.toHaveBeenCalled();
  });
});
