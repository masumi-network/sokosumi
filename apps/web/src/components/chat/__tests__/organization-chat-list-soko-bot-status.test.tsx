import { SokoBotStatus } from "@sokosumi/core-client";
import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishLiveSokoBot } from "@/components/chat/personal-assistant-chrome-store";

import { makeUser } from "./chat-room-fixtures";
import {
  emptyListResult,
  listRoomsMock,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const sokoBot = {
  id: "bot-1",
  name: "Juno",
  caption: null,
  image: null,
  avatarSeed: null,
  ownerUserId: "user-1",
  scope: "personal" as const,
  sharedRoomId: null,
  presence: "online" as const,
};

describe("OrganizationChatList your Soko Bot's Direct", () => {
  let clearLiveBot: () => void = () => {};

  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  afterEach(() => {
    act(() => clearLiveBot());
  });

  it("says the status the sidebar's bot row says, on that Direct only", async () => {
    const botDirect = makeRoom({
      id: "bot-direct",
      kind: "direct",
      myAccess: "member",
      userMembers: [makeUser("user-1")],
      sokoBotMembers: [sokoBot],
    });
    const personDirect = makeRoom({
      id: "person-direct",
      kind: "direct",
      myAccess: "member",
    });
    clearLiveBot = publishLiveSokoBot({
      id: sokoBot.id,
      status: SokoBotStatus.ERROR,
      lastActivityAt: null,
    });

    listRoomsMock.mockResolvedValue(emptyListResult([botDirect, personDirect]));
    await act(async () =>
      renderOrganizationChatList({ rooms: [botDirect, personDirect] }),
    );

    const [botRow, personRow] = screen.getAllByTestId("room-row");
    expect(
      within(botRow as HTMLElement).getByText(
        "Components.SokoBot.BotStatus.ERROR",
      ),
    ).toBeInTheDocument();
    expect(personRow).not.toHaveTextContent("BotStatus");
  });

  it("says nothing extra while no bot row is live", async () => {
    const botDirect = makeRoom({
      id: "bot-direct",
      kind: "direct",
      myAccess: "member",
      userMembers: [makeUser("user-1")],
      sokoBotMembers: [sokoBot],
    });

    listRoomsMock.mockResolvedValue(emptyListResult([botDirect]));
    await act(async () => renderOrganizationChatList({ rooms: [botDirect] }));

    expect(screen.getByTestId("room-row")).not.toHaveTextContent("BotStatus");
  });
});
