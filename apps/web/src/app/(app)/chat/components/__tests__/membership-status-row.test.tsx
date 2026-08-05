import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { MembershipStatusRow } from "../membership-status-row";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    return (key: string, values?: Record<string, unknown>) => {
      if (key === "joined" && values) {
        return `${values.name} joined`;
      }
      if (key === "left" && values) {
        return `${values.name} left`;
      }
      return key;
    };
  },
}));

function membershipMessage(
  action: "joined" | "left",
  name: string,
  subjectType: "user" | "coworker" = "user",
): ChatRoomMessage {
  return {
    id: `status-${action}`,
    roomId: "room-1",
    parentMessageId: null,
    content: "",
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    editedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: {
      action,
      subject: { type: subjectType, id: "subject-1", name },
    },
    unfurls: null,
    sender: { type: "unknown" },
  };
}

describe("MembershipStatusRow", () => {
  it("renders i18n joined status from membership payload", () => {
    render(
      <MembershipStatusRow message={membershipMessage("joined", "Alice")} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Alice joined");
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-membership-status",
      "joined",
    );
  });

  it("renders i18n left status for coworker subjects", () => {
    render(
      <MembershipStatusRow
        message={membershipMessage("left", "Jamal", "coworker")}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Jamal left");
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-membership-status",
      "left",
    );
  });

  it("renders nothing when membership is null", () => {
    const { container } = render(
      <MembershipStatusRow
        message={{
          ...membershipMessage("joined", "Alice"),
          membership: null,
          unfurls: null,
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
