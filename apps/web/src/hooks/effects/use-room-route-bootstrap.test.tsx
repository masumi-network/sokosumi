import type { ChatRoomMessage } from "@sokosumi/core-client";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { Activity, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RoomsClientProps } from "@/app/chat/components/rooms-client";
import { RoomTranscriptCache } from "@/app/chat/utils/room-transcript-cache";
import {
  RoomBootstrapContext,
  useRoomRouteBootstrap,
} from "./use-room-route-bootstrap";

function makeMessage(id: string, content: string): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-11-24T10:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    sender: { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
  };
}

function makeProps(
  overrides: Partial<RoomsClientProps> = {},
): RoomsClientProps {
  return {
    loadHistoryOnClient: false,
    activeOrganization: { id: "org-1", slug: "org-slug" },
    rooms: [],
    organizationMembers: [],
    currentUserId: "user-1",
    isOrgOwnerOrAdmin: false,
    coworkers: [],
    selectedRoomId: "room-1",
    messageLoadFailed: false,
    membersLoadFailed: false,
    messages: [makeMessage("msg-1", "hello")],
    messagesNextCursor: null,
    ...overrides,
  };
}

describe("useRoomRouteBootstrap", () => {
  it("registers props from context and seeds the cache in layout phase before paint, then updates bootstrap on an existing entry", () => {
    const cache = new RoomTranscriptCache(new QueryClient(), "user-1", "org-1");
    const register = vi.fn();
    let hasProvider = false;
    const layoutSnapshot: Array<{
      registerCalls: number;
      cachedMessages: string[];
      cachedAdmin: boolean | undefined;
    }> = [];

    function Probe({ props }: { props: RoomsClientProps }) {
      hasProvider = useRoomRouteBootstrap(cache, props);
      useLayoutEffect(() => {
        const entry = props.selectedRoomId
          ? cache.get(props.selectedRoomId)
          : undefined;
        layoutSnapshot.push({
          registerCalls: register.mock.calls.length,
          cachedMessages: entry?.transcript.messages.map((m) => m.id) ?? [],
          cachedAdmin: entry?.bootstrap.isOrgOwnerOrAdmin,
        });
      });
      return null;
    }

    const firstProps = makeProps({ isOrgOwnerOrAdmin: false });
    const { rerender } = render(
      <RoomBootstrapContext value={register}>
        <Probe props={firstProps} />
      </RoomBootstrapContext>,
    );

    expect(hasProvider).toBe(true);
    // Observed synchronously in sibling useLayoutEffect (before paint).
    expect(layoutSnapshot).toEqual([
      {
        registerCalls: 1,
        cachedMessages: ["msg-1"],
        cachedAdmin: false,
      },
    ]);
    expect(register).toHaveBeenCalledWith(firstProps);
    const initialEntry = cache.get("room-1");
    expect(initialEntry?.resolved).toBe(true);
    expect(initialEntry?.bootstrap.messages).toEqual([]);
    expect(initialEntry?.bootstrap.loadHistoryOnClient).toBe(true);

    // Updating an existing room entry replaces bootstrap metadata (stripped of
    // messages and marked loadHistoryOnClient) while preserving retained
    // transcript, revision, and lifetime identity.
    const nextProps = makeProps({
      isOrgOwnerOrAdmin: true,
      messages: [makeMessage("msg-2", "replacement")],
      loadHistoryOnClient: false,
    });
    rerender(
      <RoomBootstrapContext value={register}>
        <Probe props={nextProps} />
      </RoomBootstrapContext>,
    );

    const updatedEntry = cache.get("room-1");
    expect(register).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenLastCalledWith(nextProps);
    expect(updatedEntry?.lifetime).toBe(initialEntry?.lifetime);
    expect(updatedEntry?.transcript).toBe(initialEntry?.transcript);
    expect(updatedEntry?.bootstrap.isOrgOwnerOrAdmin).toBe(true);
    expect(updatedEntry?.bootstrap.messages).toEqual([]);
    expect(updatedEntry?.bootstrap.loadHistoryOnClient).toBe(true);
    expect(layoutSnapshot.at(-1)).toEqual({
      registerCalls: 2,
      cachedMessages: ["msg-1"],
      cachedAdmin: true,
    });
  });

  it("no-ops when cache is null, room id is missing, room is unavailable, or scope does not match", () => {
    const register = vi.fn();

    function Probe({
      cache,
      props,
    }: {
      cache: RoomTranscriptCache | null;
      props: RoomsClientProps;
    }) {
      useRoomRouteBootstrap(cache, props);
      return null;
    }

    const props = makeProps();
    const { rerender } = render(
      <RoomBootstrapContext value={register}>
        <Probe cache={null} props={props} />
      </RoomBootstrapContext>,
    );
    expect(register).not.toHaveBeenCalled();

    const cache = new RoomTranscriptCache(new QueryClient(), "user-1", "org-1");

    // Missing selectedRoomId
    rerender(
      <RoomBootstrapContext value={register}>
        <Probe cache={cache} props={makeProps({ selectedRoomId: null })} />
      </RoomBootstrapContext>,
    );
    expect(register).not.toHaveBeenCalled();
    expect(cache.get("room-1")).toBeUndefined();

    // Evicted (unavailable) room
    cache.evict("room-1");
    rerender(
      <RoomBootstrapContext value={register}>
        <Probe cache={cache} props={props} />
      </RoomBootstrapContext>,
    );
    expect(register).not.toHaveBeenCalled();
    expect(cache.get("room-1")).toBeUndefined();

    // Mismatched workspace scope
    const otherWorkspaceCache = new RoomTranscriptCache(
      new QueryClient(),
      "user-1",
      "org-other",
    );
    rerender(
      <RoomBootstrapContext value={register}>
        <Probe cache={otherWorkspaceCache} props={props} />
      </RoomBootstrapContext>,
    );
    expect(register).not.toHaveBeenCalled();
    expect(otherWorkspaceCache.get("room-1")).toBeUndefined();
  });

  it("reports no provider for fallback rendering while still seeding the cache and re-seeding on Activity reveal", () => {
    const cache = new RoomTranscriptCache(new QueryClient(), "user-1", "org-1");
    const props = makeProps();
    let hasProvider = true;
    const layoutSeeded: boolean[] = [];

    function Probe() {
      hasProvider = useRoomRouteBootstrap(cache, props);
      useLayoutEffect(() => {
        layoutSeeded.push(cache.get("room-1") != null);
      });
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(hasProvider).toBe(false);
    expect(layoutSeeded).toEqual([true]);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    cache.clear();
    expect(cache.get("room-1")).toBeUndefined();
    cache.activate();

    layoutSeeded.length = 0;
    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    expect(hasProvider).toBe(false);
    expect(layoutSeeded).toEqual([true]);
    expect(cache.get("room-1")?.transcript.messages[0]?.id).toBe("msg-1");
  });
});
