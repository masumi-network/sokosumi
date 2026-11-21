import type { ChatRoom } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getRememberedPinnedRooms,
  rememberPinnedRooms,
} from "@/components/chat/remembered-pinned-rooms";
import { useRememberPinnedRooms } from "./use-remember-pinned-rooms";

const roomA = { id: "room-a", name: "Room A" } as ChatRoom;
const roomB = { id: "room-b", name: "Room B" } as ChatRoom;

function Rememberer({
  currentUserId,
  pinned,
  enabled = true,
}: {
  currentUserId: string;
  pinned: readonly ChatRoom[];
  enabled?: boolean;
}) {
  useRememberPinnedRooms(currentUserId, pinned, enabled);
  return null;
}

describe("useRememberPinnedRooms", () => {
  beforeEach(() => {
    rememberPinnedRooms("", []);
  });

  it("remembers pinned rooms when enabled and skips when disabled", () => {
    const { rerender } = render(
      <Rememberer currentUserId="user-1" pinned={[roomA]} enabled={false} />,
    );
    expect(getRememberedPinnedRooms("user-1")).toEqual([]);

    rerender(<Rememberer currentUserId="user-1" pinned={[roomA]} enabled />);
    expect(getRememberedPinnedRooms("user-1")).toEqual([roomA]);

    rerender(
      <Rememberer currentUserId="user-1" pinned={[roomA, roomB]} enabled />,
    );
    expect(getRememberedPinnedRooms("user-1")).toEqual([roomA, roomB]);
  });

  it("re-publishes on React Activity reveal after another render cleared it", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <Rememberer currentUserId="user-2" pinned={[roomA]} />
      </Activity>,
    );
    expect(getRememberedPinnedRooms("user-2")).toEqual([roomA]);

    rerender(
      <Activity mode="hidden">
        <Rememberer currentUserId="user-2" pinned={[roomA]} />
      </Activity>,
    );
    rememberPinnedRooms("user-2", []);
    expect(getRememberedPinnedRooms("user-2")).toEqual([]);

    rerender(
      <Activity mode="visible">
        <Rememberer currentUserId="user-2" pinned={[roomA]} />
      </Activity>,
    );
    expect(getRememberedPinnedRooms("user-2")).toEqual([roomA]);
  });

  it("does not write during SSR", () => {
    renderToString(<Rememberer currentUserId="user-ssr" pinned={[roomA]} />);
    expect(getRememberedPinnedRooms("user-ssr")).toEqual([]);
  });
});
