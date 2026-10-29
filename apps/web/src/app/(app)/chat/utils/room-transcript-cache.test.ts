import type { ChatRoomMessage } from "@sokosumi/core-client";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRoomMessages } from "@/components/chat/fetch-room-messages";
import { RoomTranscriptCache } from "./room-transcript-cache";

vi.mock("@/components/chat/fetch-room-messages", () => ({
  fetchRoomMessages: vi.fn(),
}));

function message(index: number): ChatRoomMessage {
  return {
    id: `m${index}`,
    roomId: "room",
    parentMessageId: null,
    content: `Message ${index}`,
    createdAt: new Date(index * 1000),
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
function retained() {
  const cache = new RoomTranscriptCache(
    new QueryClient(),
    "reader",
    "workspace",
  );
  const entry = cache.seed({
    activeOrganization: null,
    rooms: [],
    organizationMembers: [],
    currentUserId: "reader",
    isOrgOwnerOrAdmin: false,
    coworkers: [],
    selectedRoomId: "room",
    messageLoadFailed: false,
    membersLoadFailed: false,
    messages: [message(1), message(10), message(11), message(12), message(90)],
    messagesNextCursor: "m1",
  });
  cache.client.setQueryData(cache.key("room"), entry);
  cache.setPosition("room", entry.lifetime, {
    anchorId: "m10",
    anchorCreatedAt: 10000,
    offset: 0,
    atLiveEdge: false,
    visibleMessageIds: ["m10", "m11", "m12"],
  });
  cache.markDirty("room");
  return { cache, lifetime: entry.lifetime };
}
const head = { messages: [message(90)], nextCursor: "m90" };

describe("authoritative retained history reconciliation", () => {
  it("shares query defaults across cleared user and workspace scopes", () => {
    const client = new QueryClient();
    const registerDefaults = vi.spyOn(client, "setQueryDefaults");
    const first = new RoomTranscriptCache(
      client,
      "first-user",
      "first-workspace",
    );
    first.clear();
    const second = new RoomTranscriptCache(client, "second-user", null);
    expect(registerDefaults.mock.calls.map(([key]) => key)).toEqual([
      ["room-transcript"],
      ["room-transcript"],
    ]);
    expect(client.getQueryDefaults(second.key("room"))).toMatchObject({
      gcTime: 30 * 60 * 1000,
      enabled: false,
      structuralSharing: false,
    });
    second.clear();
  });
  beforeEach(() => vi.mocked(fetchRoomMessages).mockReset());

  it("follows older pagination before removing an absent historical message", async () => {
    const { cache, lifetime } = retained();
    vi.mocked(fetchRoomMessages)
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce({
        messages: [message(12), message(13)],
        nextCursor: "m12",
      })
      .mockResolvedValueOnce({
        messages: [{ ...message(10), content: "edited while away" }],
        nextCursor: "m10",
      });
    await cache.refresh("room", lifetime, () => true);
    expect(
      cache.get("room")?.transcript.messages.map((row) => row.content),
    ).toEqual([
      "Message 1",
      "edited while away",
      "Message 12",
      "Message 13",
      "Message 90",
    ]);
    cache.clear();
  });

  it("preserves cached rows when historical coverage is incomplete", async () => {
    const { cache, lifetime } = retained();
    vi.mocked(fetchRoomMessages)
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce({
        messages: [message(12), message(13)],
        nextCursor: "m12",
      })
      .mockResolvedValueOnce(null);
    await cache.refresh("room", lifetime, () => true);
    expect(cache.get("room")?.transcript.messages.map((row) => row.id)).toEqual(
      ["m1", "m10", "m11", "m12", "m90"],
    );
    // A subsequent scheduler pass retries the unproven window.
    vi.mocked(fetchRoomMessages)
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce({
        messages: [message(10), message(12)],
        nextCursor: "m10",
      });
    await cache.refresh("room", lifetime, () => true);
    expect(cache.get("room")?.transcript.messages.map((row) => row.id)).toEqual(
      ["m1", "m10", "m12", "m90"],
    );
    cache.clear();
  });

  it("uses a surviving upper boundary when the saved anchor was removed", async () => {
    const { cache, lifetime } = retained();
    vi.mocked(fetchRoomMessages)
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        messages: [message(11), message(90)],
        nextCursor: "m11",
      })
      .mockResolvedValueOnce({ messages: [message(10)], nextCursor: "m10" });
    await cache.refresh("room", lifetime, () => true);
    expect(cache.get("room")?.transcript.messages.map((row) => row.id)).toEqual(
      ["m1", "m10", "m11", "m90"],
    );
    cache.clear();
  });

  it("replaces transcript identity when reconciliation writes", async () => {
    const { cache, lifetime } = retained();
    const before = cache.get("room")?.transcript;
    const position = cache.getPosition("room");
    vi.mocked(fetchRoomMessages).mockResolvedValueOnce({
      messages: [message(90)],
      nextCursor: null,
    });
    await cache.refresh("room", lifetime, () => true);
    expect(cache.get("room")?.transcript).not.toBe(before);
    expect(cache.getPosition("room")).toBe(position);
    cache.clear();
  });

  it("does not resurrect a realtime deletion received during a snapshot", async () => {
    const { cache, lifetime } = retained();
    let finish!: (page: typeof head) => void;
    vi.mocked(fetchRoomMessages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const refreshing = cache.refresh("room", lifetime, () => true);
    cache.setTranscript("room", lifetime, (current) => ({
      ...current,
      messages: current.messages.filter((row) => row.id !== "m90"),
    }));
    finish(head);
    expect(await refreshing).toBe("stale");
    expect(
      cache.get("room")?.transcript.messages.some((row) => row.id === "m90"),
    ).toBe(false);
    cache.clear();
  });

  it("does not restore cleared-session history from an outstanding request", async () => {
    const { cache, lifetime } = retained();
    const position = cache.getPosition("room")!;
    let finish!: (page: typeof head) => void;
    vi.mocked(fetchRoomMessages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const refreshing = cache.refresh("room", lifetime, () => true);
    cache.clear();
    finish(head);
    await refreshing;
    expect(cache.get("room")).toBeUndefined();
    cache.setPosition("room", lifetime, position);
    expect(cache.getPosition("room")).toBeUndefined();
  });
  it("starts a separate read after leaving and rejoining during an old request", async () => {
    const { cache, lifetime } = retained();
    let finish!: (page: typeof head) => void;
    vi.mocked(fetchRoomMessages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const oldRead = cache.refresh("room", lifetime, () => true);
    const props = cache.get("room")!.bootstrap;
    cache.evict("room");
    cache.joined("room");
    const rejoined = cache.seed(props);
    cache.client.setQueryData(cache.key("room"), rejoined);
    cache.setPosition("room", lifetime, {
      anchorId: "m10",
      anchorCreatedAt: 10000,
      offset: 42,
      atLiveEdge: false,
      visibleMessageIds: ["m10"],
    });
    expect(cache.getPosition("room")).toBeUndefined();
    vi.mocked(fetchRoomMessages).mockResolvedValueOnce({
      messages: [{ ...message(90), content: "after rejoin" }],
      nextCursor: null,
    });
    await cache.refresh("room", rejoined.lifetime, () => true);
    finish(head);
    await oldRead;
    expect(
      cache.get("room")?.transcript.messages.map((row) => row.content),
    ).toEqual(["after rejoin"]);
    expect(fetchRoomMessages).toHaveBeenCalledTimes(2);
    cache.clear();
  });
});

describe("room open prefetched on click", () => {
  function opening() {
    const cache = new RoomTranscriptCache(
      new QueryClient(),
      "reader",
      "workspace",
    );
    const seed = () => {
      const entry = cache.seed({
        activeOrganization: null,
        rooms: [],
        organizationMembers: [],
        currentUserId: "reader",
        isOrgOwnerOrAdmin: false,
        coworkers: [],
        selectedRoomId: "room",
        messageLoadFailed: false,
        membersLoadFailed: false,
        messages: [],
        messagesNextCursor: null,
        loadHistoryOnClient: true,
      });
      cache.client.setQueryData(cache.key("room"), entry);
      return entry.lifetime;
    };
    return { cache, seed };
  }
  beforeEach(() => {
    vi.mocked(fetchRoomMessages).mockReset();
    vi.useRealTimers();
  });

  it("serves the open's first head read from the click's read", async () => {
    const { cache, seed } = opening();
    vi.mocked(fetchRoomMessages).mockResolvedValue(head);
    cache.prefetch("room");
    expect(fetchRoomMessages).toHaveBeenCalledTimes(1);
    const lifetime = seed();
    await cache.refresh("room", lifetime, () => true);
    expect(fetchRoomMessages).toHaveBeenCalledTimes(1);
    expect(cache.get("room")?.resolved).toBe(true);
    expect(cache.get("room")?.transcript.messages).toEqual([message(90)]);

    await cache.refresh("room", lifetime, () => true);
    expect(fetchRoomMessages).toHaveBeenCalledTimes(2);
  });

  it("does not prefetch a room already painted from cache", () => {
    const { cache } = retained();
    cache.prefetch("room");
    expect(fetchRoomMessages).not.toHaveBeenCalled();
  });

  it("reads again with access handling when the click's read failed", async () => {
    const { cache, seed } = opening();
    vi.mocked(fetchRoomMessages)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(head);
    cache.prefetch("room");
    await cache.refresh("room", seed(), () => true);
    expect(fetchRoomMessages).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchRoomMessages).mock.calls[1][3]).toEqual(
      expect.any(Function),
    );
    expect(cache.get("room")?.transcript.messages).toEqual([message(90)]);
  });

  it("drops a click's read the transcript has moved past", async () => {
    const { cache, seed } = opening();
    vi.mocked(fetchRoomMessages).mockResolvedValue(head);
    cache.prefetch("room");
    const lifetime = seed();
    cache.setTranscript("room", lifetime, (transcript) => ({
      ...transcript,
      messages: [message(90)],
    }));
    await cache.refresh("room", lifetime, () => true);
    expect(fetchRoomMessages).toHaveBeenCalledTimes(2);
  });

  function provisional() {
    return vi.fn(() => ({
      activeOrganization: { id: "workspace", slug: null },
      rooms: [],
      organizationMembers: [],
      currentUserId: "reader",
      isOrgOwnerOrAdmin: false,
      coworkers: [],
      selectedRoomId: "room",
      messageLoadFailed: false,
      membersLoadFailed: false,
      messages: [],
      messagesNextCursor: null,
      loadHistoryOnClient: true,
    }));
  }

  it("paints a room from the click's read before its page registers", async () => {
    const { cache } = opening();
    vi.mocked(fetchRoomMessages).mockResolvedValue(head);
    const props = provisional();
    cache.prefetch("room", props);
    await vi.waitFor(() => expect(cache.get("room")).toBeDefined());
    const entry = cache.get("room")!;
    expect(entry.resolved).toBe(true);
    expect(entry.transcript.messages).toEqual([message(90)]);
    expect(entry.bootstrap.selectedRoomId).toBe("room");

    // The room's mount read is the click's read, not a second request.
    await cache.refresh("room", entry.lifetime, () => true);
    expect(fetchRoomMessages).toHaveBeenCalledTimes(1);
  });

  it("does not paint a room whose click read was refused", async () => {
    const { cache } = opening();
    vi.mocked(fetchRoomMessages).mockResolvedValue(null);
    const props = provisional();
    cache.prefetch("room", props);
    await vi.waitFor(() => expect(fetchRoomMessages).toHaveBeenCalled());
    await Promise.resolve();
    expect(props).not.toHaveBeenCalled();
    expect(cache.get("room")).toBeUndefined();
  });

  it("keeps the page's bootstrap when it registers before the click's read", async () => {
    const { cache, seed } = opening();
    let land: (page: typeof head) => void = () => {};
    vi.mocked(fetchRoomMessages).mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    const props = provisional();
    cache.prefetch("room", props);
    seed();
    land(head);
    await Promise.resolve();
    await Promise.resolve();
    expect(props).not.toHaveBeenCalled();
    expect(cache.get("room")?.bootstrap.activeOrganization).toBeNull();
  });

  it("hands the click's open-at-unread read to one visit", async () => {
    const { cache } = opening();
    vi.mocked(fetchRoomMessages).mockResolvedValue(head);
    cache.prefetchUnreadWindow("room");
    expect(vi.mocked(fetchRoomMessages).mock.calls[0]?.[2]).toEqual({
      openAtUnread: true,
    });

    await expect(cache.takeUnreadWindow("room")).resolves.toEqual(head);
    expect(cache.takeUnreadWindow("room")).toBeUndefined();
  });

  it("drops a click's open-at-unread read after the open window or an eviction", () => {
    vi.useFakeTimers();
    const { cache } = opening();
    vi.mocked(fetchRoomMessages).mockResolvedValue(head);
    cache.prefetchUnreadWindow("room");
    vi.advanceTimersByTime(10_001);
    expect(cache.takeUnreadWindow("room")).toBeUndefined();

    cache.prefetchUnreadWindow("room");
    cache.evict("room");
    expect(cache.takeUnreadWindow("room")).toBeUndefined();
  });

  it("does not hand an old click's read to a later open", async () => {
    vi.useFakeTimers();
    const { cache, seed } = opening();
    vi.mocked(fetchRoomMessages).mockResolvedValue(head);
    cache.prefetch("room");
    vi.advanceTimersByTime(10_001);
    await cache.refresh("room", seed(), () => true);
    expect(fetchRoomMessages).toHaveBeenCalledTimes(2);
  });
});
