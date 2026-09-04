import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRoom } from "@/lib/clients/generated/core";
import {
  notifyOrganizationChatRoomsChanged,
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
} from "./organization-chat-events";

function makeRoom(id = "room-1"): ChatRoom {
  return {
    id,
    organizationId: "org-1",
    organizationName: null,
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: "user-1",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [],
    coworkerMembers: [],
    orchestratorMembers: [],
  };
}

describe("notifyOrganizationChatRoomsChanged", () => {
  const listeners: Array<(event: Event) => void> = [];

  beforeEach(() => {
    listeners.length = 0;
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, listener) => {
        if (
          type === ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT &&
          typeof listener === "function"
        ) {
          listeners.push(listener as (event: Event) => void);
        }
      },
    );
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      for (const listener of listeners) {
        listener(event);
      }
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches a ChatRoom as room upsert detail", () => {
    const room = makeRoom();
    let detail: unknown;
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, (event) => {
      detail = (event as CustomEvent).detail;
    });

    notifyOrganizationChatRoomsChanged(room);

    expect(detail).toEqual({ room });
  });

  it("dispatches removedRoomId for leave", () => {
    let detail: unknown;
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, (event) => {
      detail = (event as CustomEvent).detail;
    });

    notifyOrganizationChatRoomsChanged({ removedRoomId: "room-left" });

    expect(detail).toEqual({ removedRoomId: "room-left" });
  });

  it("dispatches empty detail for bare refresh", () => {
    let detail: unknown;
    window.addEventListener(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, (event) => {
      detail = (event as CustomEvent).detail;
    });

    notifyOrganizationChatRoomsChanged();

    expect(detail).toEqual({});
  });
});
