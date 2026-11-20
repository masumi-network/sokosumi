import { render, screen } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomTypingStore } from "@/hooks/effects/use-room-typing";

const useRoomTypingSyncMock = vi.fn();

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/effects/use-room-typing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/effects/use-room-typing")>();
  return {
    ...actual,
    useRoomTypingSync: (...args: unknown[]) => useRoomTypingSyncMock(...args),
  };
});

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
    useRoomTypingSyncMock.mockReset();
  });

  it("stays inert outside a provider, so the Thread composer says nothing", () => {
    render(<Consumer />);

    expect(screen.getByTestId("consumer")).toHaveTextContent("false:");
    expect(useRoomTypingSyncMock).not.toHaveBeenCalled();
  });

  it("reports the room's typists to whatever it wraps", () => {
    useRoomTypingSyncMock.mockImplementation(
      (roomId: string, _userId: string, store: RoomTypingStore) => {
        useEffect(() => {
          store.setTypistIds(roomId, ["user_pat"]);
        }, [roomId, store]);
      },
    );

    render(
      <RoomTypingProvider roomId="room-a" currentUserId="user_me">
        <Consumer />
      </RoomTypingProvider>,
    );

    expect(screen.getByTestId("consumer")).toHaveTextContent("true:user_pat");
    expect(useRoomTypingSyncMock).toHaveBeenCalledWith(
      "room-a",
      "user_me",
      expect.any(Object),
    );
  });

  it("settles when the room hands it a fresh array of the same people", () => {
    let renders = 0;
    useRoomTypingSyncMock.mockImplementation(
      (roomId: string, _userId: string, store: RoomTypingStore) => {
        renders += 1;
        useEffect(() => {
          store.setTypistIds(roomId, ["user_pat"]);
        });
      },
    );

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
    expect(useRoomTypingSyncMock).not.toHaveBeenCalled();
  });
});
