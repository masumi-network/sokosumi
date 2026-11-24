// @vitest-environment happy-dom

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { Activity, StrictMode, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatListStore } from "@/components/chat/chat-list-store";

import { useChatListStoreBinding } from "./use-chat-list-store-binding";

const NO_ROOMS: ChatRoom[] = [];
const NO_INVITATIONS: ChatRoomInvitation[] = [];

function makeStoreSpy() {
  const events: string[] = [];
  const store: ChatListStore = {
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => ({
      roomRows: NO_ROOMS,
      archivedRows: NO_ROOMS,
      pendingRows: NO_INVITATIONS,
    })),
    attach: vi.fn((scope) => {
      events.push(
        `attach:${scope.organizationId ?? ""}:${scope.currentUserId}`,
      );
    }),
    detach: vi.fn(() => {
      events.push("detach");
    }),
    setHealth: vi.fn((healthy) => {
      events.push(`health:${healthy}`);
    }),
    syncProps: vi.fn((props) => {
      events.push(`syncProps:${props.rooms.length}`);
    }),
    setArchivedRows: vi.fn(),
    setPendingRows: vi.fn(),
    upsertRoomToTop: vi.fn(),
    replaceRoom: vi.fn(),
    replaceAllRooms: vi.fn(() => true),
    applyPinnedOrder: vi.fn(),
  };
  return { store, events };
}

interface ProbeProps {
  store: ChatListStore;
  rooms?: ChatRoom[];
  archivedRooms?: ChatRoom[];
  pendingInvitations?: ChatRoomInvitation[];
  currentUserId?: string;
  organizationId?: string | null;
  paintOnly?: boolean;
  healthy?: boolean;
  onPassiveEffect?: () => void;
}

function BindingProbe({
  store,
  rooms = NO_ROOMS,
  archivedRooms = NO_ROOMS,
  pendingInvitations = NO_INVITATIONS,
  currentUserId = "user-1",
  organizationId = "org-1",
  paintOnly = false,
  healthy = true,
  onPassiveEffect,
}: ProbeProps) {
  useChatListStoreBinding({
    store,
    rooms,
    archivedRooms,
    pendingInvitations,
    currentUserId,
    organizationId,
    paintOnly,
    healthy,
  });

  useEffect(() => {
    onPassiveEffect?.();
  });

  return null;
}

describe("useChatListStoreBinding", () => {
  it("attaches on mount, detaches on unmount, and handles scope changes", () => {
    const { store, events } = makeStoreSpy();

    const { rerender, unmount } = render(
      <BindingProbe
        store={store}
        organizationId="org-1"
        currentUserId="user-1"
        healthy={true}
      />,
    );

    expect(events).toEqual([
      "syncProps:0",
      "attach:org-1:user-1",
      "health:true",
    ]);

    events.length = 0;
    rerender(
      <BindingProbe
        store={store}
        organizationId="org-2"
        currentUserId="user-1"
        healthy={true}
      />,
    );
    expect(events).toEqual(["detach", "attach:org-2:user-1"]);

    events.length = 0;
    rerender(
      <BindingProbe
        store={store}
        organizationId="org-2"
        currentUserId="user-1"
        healthy={false}
      />,
    );
    expect(events).toEqual(["health:false"]);

    events.length = 0;
    unmount();
    expect(events).toEqual(["detach"]);
  });

  it("skips attach and detach when paintOnly is true", () => {
    const { store } = makeStoreSpy();

    const { unmount } = render(<BindingProbe store={store} paintOnly={true} />);

    expect(store.attach).not.toHaveBeenCalled();
    unmount();
    expect(store.detach).not.toHaveBeenCalled();
  });

  it("detaches on React Activity hide and re-attaches on Activity reveal", () => {
    const { store, events } = makeStoreSpy();

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <BindingProbe store={store} />
        </Activity>
      </StrictMode>,
    );

    expect(store.attach).toHaveBeenCalledTimes(2);
    expect(store.detach).toHaveBeenCalledTimes(1);

    events.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <BindingProbe store={store} />
        </Activity>
      </StrictMode>,
    );
    expect(events).toEqual(["detach"]);

    events.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <BindingProbe store={store} />
        </Activity>
      </StrictMode>,
    );
    expect(events).toContain("attach:org-1:user-1");

    unmount();
  });

  it("hands changed RSC rows to the store in a layout effect before passive effects run", () => {
    const { store, events } = makeStoreSpy();
    const recordPassive = () => {
      events.push("passive");
    };

    const { rerender } = render(
      <BindingProbe store={store} onPassiveEffect={recordPassive} />,
    );
    events.length = 0;

    const nextRooms = [{ id: "room-1" } as ChatRoom];
    rerender(
      <BindingProbe
        store={store}
        rooms={nextRooms}
        onPassiveEffect={recordPassive}
      />,
    );

    expect(events).toEqual(["syncProps:1", "passive"]);
    expect(store.syncProps).toHaveBeenLastCalledWith({
      rooms: nextRooms,
      archivedRooms: NO_ROOMS,
      pendingInvitations: NO_INVITATIONS,
    });
  });
});
