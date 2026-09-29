import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { RoomStatusRow } from "./room-status-row";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    return (key: string, values?: Record<string, unknown>) => {
      if (key === "MembershipStatus.joined" && values) {
        return `${values.name} joined`;
      }
      if (key === "MembershipStatus.left" && values) {
        return `${values.name} left`;
      }
      if (key === "GroupName.named" && values) {
        return `${values.name} named the group ${values.groupName}`;
      }
      if (key === "GroupName.cleared" && values) {
        return `${values.name} removed the group name`;
      }
      return key;
    };
  },
}));

function statusMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "status-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "",
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: { type: "unknown" },
    ...overrides,
  };
}

function membershipMessage(
  action: "joined" | "left",
  name: string,
  subjectType: "user" | "coworker" = "user",
): ChatRoomMessage {
  return statusMessage({
    membership: {
      action,
      subject: { type: subjectType, id: "subject-1", name },
    },
  });
}

describe("RoomStatusRow", () => {
  it("renders i18n joined status from membership payload", () => {
    render(<RoomStatusRow message={membershipMessage("joined", "Alice")} />);

    expect(screen.getByRole("status")).toHaveTextContent("Alice joined");
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-membership-status",
      "joined",
    );
  });

  it("renders i18n left status for coworker subjects", () => {
    render(
      <RoomStatusRow
        message={membershipMessage("left", "Jamal", "coworker")}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Jamal left");
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-membership-status",
      "left",
    );
  });

  it("says who named the group and what", () => {
    render(
      <RoomStatusRow
        message={statusMessage({
          groupNameChange: {
            action: "named",
            name: "Launch crew",
            actor: { id: "user-1", name: "Alice" },
          },
        })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Alice named the group Launch crew",
    );
  });

  it("says who removed the group name", () => {
    render(
      <RoomStatusRow
        message={statusMessage({
          groupNameChange: {
            action: "cleared",
            name: null,
            actor: { id: "user-1", name: "Alice" },
          },
        })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Alice removed the group name",
    );
  });

  it("renders nothing for an ordinary message", () => {
    const { container } = render(<RoomStatusRow message={statusMessage()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
