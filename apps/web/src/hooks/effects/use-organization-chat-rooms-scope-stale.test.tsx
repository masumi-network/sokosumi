import { act, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, expect, it } from "vitest";
import {
  type OrganizationChatRoomsStaleActive,
  useOrganizationChatRoomsScopeStale,
} from "./use-organization-chat-rooms-scope-stale";

function ScopeStaleProbe({
  staleActiveRef,
  scope,
}: {
  staleActiveRef: { current: OrganizationChatRoomsStaleActive };
  scope: string | null;
}) {
  useOrganizationChatRoomsScopeStale(staleActiveRef, scope);
  return null;
}

describe("useOrganizationChatRoomsScopeStale", () => {
  it("resets stale rooms on mount and scope change, and marks wholeList on browser online", () => {
    const staleActiveRef = {
      current: { rooms: new Set(["room-old"]), wholeList: false },
    };

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <ScopeStaleProbe
            staleActiveRef={staleActiveRef}
            scope="org-1:user-1"
          />
        </Activity>
      </StrictMode>,
    );

    expect(staleActiveRef.current.wholeList).toBe(true);
    expect([...staleActiveRef.current.rooms]).toEqual([]);

    // Online event marks wholeList true without clearing rooms.
    staleActiveRef.current = { rooms: new Set(["room-a"]), wholeList: false };
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(staleActiveRef.current.wholeList).toBe(true);

    // Same scope rerender leaves state untouched.
    staleActiveRef.current = { rooms: new Set(["room-a"]), wholeList: false };
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ScopeStaleProbe
            staleActiveRef={staleActiveRef}
            scope="org-1:user-1"
          />
        </Activity>
      </StrictMode>,
    );
    expect(staleActiveRef.current.wholeList).toBe(false);
    expect([...staleActiveRef.current.rooms]).toEqual(["room-a"]);

    // Scope change resets both rooms and wholeList.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ScopeStaleProbe
            staleActiveRef={staleActiveRef}
            scope="org-2:user-1"
          />
        </Activity>
      </StrictMode>,
    );
    expect(staleActiveRef.current.wholeList).toBe(true);
    expect([...staleActiveRef.current.rooms]).toEqual([]);

    // Activity hide removes the online listener; reveal re-attaches and resets.
    staleActiveRef.current = { rooms: new Set(["room-b"]), wholeList: false };
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <ScopeStaleProbe
            staleActiveRef={staleActiveRef}
            scope="org-2:user-1"
          />
        </Activity>
      </StrictMode>,
    );
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(staleActiveRef.current.wholeList).toBe(false);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ScopeStaleProbe
            staleActiveRef={staleActiveRef}
            scope="org-2:user-1"
          />
        </Activity>
      </StrictMode>,
    );
    expect(staleActiveRef.current.wholeList).toBe(true);
    expect([...staleActiveRef.current.rooms]).toEqual([]);

    // Unmount removes the online listener.
    unmount();
    staleActiveRef.current = { rooms: new Set(["room-c"]), wholeList: false };
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(staleActiveRef.current.wholeList).toBe(false);
  });
});
