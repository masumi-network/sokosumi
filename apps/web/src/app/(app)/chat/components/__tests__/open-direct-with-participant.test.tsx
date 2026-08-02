import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRoom } from "@/lib/clients/generated/core";

import {
  canShowOpenDirect,
  openDirectWithParticipant,
} from "../open-direct-with-participant";
import type { ChatParticipantHoverProfile } from "../room-helpers";

const {
  createDirectRoomActionMock,
  ensureCoworkerDirectRoomActionMock,
  notifyOrganizationChatRoomsChangedMock,
} = vi.hoisted(() => ({
  createDirectRoomActionMock: vi.fn(),
  ensureCoworkerDirectRoomActionMock: vi.fn(),
  notifyOrganizationChatRoomsChangedMock: vi.fn(),
}));

vi.mock("@/app/chat/actions", () => ({
  createDirectRoomAction: createDirectRoomActionMock,
  ensureCoworkerDirectRoomAction: ensureCoworkerDirectRoomActionMock,
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: notifyOrganizationChatRoomsChangedMock,
}));

const humanProfile: ChatParticipantHoverProfile = {
  kind: "human",
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
  presence: "online",
};

const coworkerProfile: ChatParticipantHoverProfile = {
  kind: "coworker",
  id: "coworker-1",
  name: "Hannah",
  slug: "hannah",
  caption: "Research assistant",
  image: null,
  presence: "afk",
};

function room(id: string): ChatRoom {
  return { id } as ChatRoom;
}

describe("canShowOpenDirect", () => {
  const onOpenDirect = vi.fn();

  it("hides for the current human user", () => {
    expect(
      canShowOpenDirect({
        profile: humanProfile,
        currentUserId: humanProfile.id,
        canOpenHumanDirect: true,
        onOpenDirect,
      }),
    ).toBe(false);
  });

  it("hides a human when human directs are unavailable", () => {
    expect(
      canShowOpenDirect({
        profile: humanProfile,
        currentUserId: "user-2",
        canOpenHumanDirect: false,
        onOpenDirect,
      }),
    ).toBe(false);
  });

  it("shows a coworker when human directs are unavailable", () => {
    expect(
      canShowOpenDirect({
        profile: coworkerProfile,
        currentUserId: "user-1",
        canOpenHumanDirect: false,
        onOpenDirect,
      }),
    ).toBe(true);
  });

  it("hides without an open callback", () => {
    expect(
      canShowOpenDirect({
        profile: coworkerProfile,
        currentUserId: "user-1",
        canOpenHumanDirect: true,
      }),
    ).toBe(false);
  });
});

describe("openDirectWithParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a human direct, notifies, and navigates", async () => {
    const directRoom = room("room-human");
    const push = vi.fn();
    const onError = vi.fn();
    createDirectRoomActionMock.mockResolvedValue({
      ok: true,
      data: directRoom,
    });

    const result = await openDirectWithParticipant({
      profile: humanProfile,
      selectedRoomId: "room-other",
      router: { push },
      onError,
    });

    expect(createDirectRoomActionMock).toHaveBeenCalledWith({
      memberUserId: humanProfile.id,
    });
    expect(ensureCoworkerDirectRoomActionMock).not.toHaveBeenCalled();
    expect(notifyOrganizationChatRoomsChangedMock).toHaveBeenCalledWith(
      directRoom,
    );
    expect(push).toHaveBeenCalledWith("/chat/rooms/room-human");
    expect(onError).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, roomId: "room-human" });
  });

  it("ensures a coworker direct, notifies, and navigates", async () => {
    const directRoom = room("room-coworker");
    const push = vi.fn();
    ensureCoworkerDirectRoomActionMock.mockResolvedValue({
      ok: true,
      data: directRoom,
    });

    await openDirectWithParticipant({
      profile: coworkerProfile,
      selectedRoomId: null,
      router: { push },
      onError: vi.fn(),
    });

    expect(ensureCoworkerDirectRoomActionMock).toHaveBeenCalledWith(
      coworkerProfile.id,
    );
    expect(createDirectRoomActionMock).not.toHaveBeenCalled();
    expect(notifyOrganizationChatRoomsChangedMock).toHaveBeenCalledWith(
      directRoom,
    );
    expect(push).toHaveBeenCalledWith("/chat/rooms/room-coworker");
  });

  it("skips navigation when the direct is already selected", async () => {
    const directRoom = room("room-selected");
    const push = vi.fn();
    createDirectRoomActionMock.mockResolvedValue({
      ok: true,
      data: directRoom,
    });

    await openDirectWithParticipant({
      profile: humanProfile,
      selectedRoomId: directRoom.id,
      router: { push },
      onError: vi.fn(),
    });

    expect(notifyOrganizationChatRoomsChangedMock).toHaveBeenCalledWith(
      directRoom,
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("reports action errors without notifying or navigating", async () => {
    const push = vi.fn();
    const onError = vi.fn();
    createDirectRoomActionMock.mockResolvedValue({
      ok: false,
      message: "Could not create direct.",
    });

    const result = await openDirectWithParticipant({
      profile: humanProfile,
      selectedRoomId: null,
      router: { push },
      onError,
    });

    expect(onError).toHaveBeenCalledWith("Could not create direct.");
    expect(notifyOrganizationChatRoomsChangedMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false });
  });

  it("reports a missing room without notifying or navigating", async () => {
    const push = vi.fn();
    const onError = vi.fn();
    ensureCoworkerDirectRoomActionMock.mockResolvedValue({
      ok: true,
      data: null,
    });

    const result = await openDirectWithParticipant({
      profile: coworkerProfile,
      selectedRoomId: null,
      router: { push },
      onError,
    });

    expect(onError).toHaveBeenCalledWith("Could not start direct message.");
    expect(notifyOrganizationChatRoomsChangedMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false });
  });
});
