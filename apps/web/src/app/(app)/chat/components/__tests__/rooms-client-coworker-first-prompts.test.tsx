import "./rooms-client-harness";
import type { ChatRoom, Coworker } from "@sokosumi/core-client";
import { fireEvent, screen } from "@testing-library/react";
import { type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import type { RoomSessionComposerHandle } from "../room-session-composer";
import { renderRoomsClient } from "./rooms-client-harness";

const addText = vi.fn();

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({ ref }: { ref?: Ref<RoomSessionComposerHandle> }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
      focusAtEnd: () => undefined,
      addText,
    }));
    return <div data-testid="room-session-composer" />;
  },
}));

function room(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "room-coworker",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "Ada, Eve",
    slug: "direct",
    kind: "direct",
    isSelfDirect: false,
    isGroupDirect: false,
    isReadOnly: false,
    formerUserMembers: [],
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: "private",
    createdByUserId: "user-1",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [
      {
        id: "user-1",
        name: "Ada",
        email: "user-1@example.com",
        image: null,
        presence: "offline",
      },
    ],
    coworkerMembers: [
      {
        id: "coworker-1",
        name: "Eve",
        slug: "eve",
        caption: null,
        image: null,
        presence: "online",
      },
    ],
    sokoBotMembers: [],
    ...overrides,
  };
}

const eve = {
  id: "coworker-1",
  name: "Eve",
  slug: "eve",
  metadata: {
    channels: {},
    profile: { examples: ["Plan a launch week"] },
    offers: [{ title: "Competitor brief", prompt: "Write a competitor brief" }],
  },
} as unknown as Coworker;

function renderRoom(chatRoom: ChatRoom) {
  return renderRoomsClient(
    {
      rooms: [chatRoom],
      selectedRoomId: chatRoom.id,
      messages: [],
      coworkers: [eve],
    },
    { wrapper: TestQueryProvider },
  );
}

describe("RoomsClient first prompts in an empty Coworker chat", () => {
  it("adds the picked prompt to the composer without sending", () => {
    renderRoom(room());
    expect(screen.getByText("title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Competitor brief" }));

    expect(addText).toHaveBeenCalledWith("Write a competitor brief");
  });

  it("offers no prompts in a room with people", () => {
    renderRoom(
      room({
        userMembers: [
          ...room().userMembers,
          {
            id: "user-2",
            name: "Bo",
            email: "user-2@example.com",
            image: null,
            presence: "offline",
          },
        ],
      }),
    );
    expect(screen.queryByText("title")).not.toBeInTheDocument();
  });
});
