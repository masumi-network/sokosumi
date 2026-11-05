import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeUser } from "./chat-room-fixtures";
import {
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

describe("OrganizationChatList Self Direct", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  it("names the Self Direct after the reader, marked as theirs", () => {
    const selfDirect = makeRoom({
      id: "self-direct",
      kind: "direct",
      myAccess: "member",
      isSelfDirect: true,
      userMembers: [{ ...makeUser("user-1"), name: "Andreas" }],
    });

    renderOrganizationChatList({ rooms: [selfDirect] });

    expect(
      screen.getByText("App.Channels.SelfDirect.youNamed Andreas"),
    ).toBeInTheDocument();
  });
});
