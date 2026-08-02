import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChatParticipantHoverCard } from "../chat-participant-hover-card";
import type { ChatParticipantHoverProfile } from "../room-helpers";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      coworkerBadge: "AI coworker",
      humanBadge: "Human",
      "Presence.online": "Online",
      "Presence.afk": "Away",
      "Presence.offline": "Offline",
    };
    return labels[key] ?? key;
  },
}));

vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({
    children,
    ...props
  }: {
    children: ReactNode;
    "data-testid"?: string;
  }) => <div {...props}>{children}</div>,
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

describe("ChatParticipantHoverCard", () => {
  it("shows human email and human badge", async () => {
    const user = userEvent.setup();
    render(
      <ChatParticipantHoverCard profile={humanProfile}>
        <span>Ada Lovelace</span>
      </ChatParticipantHoverCard>,
    );

    await user.hover(screen.getByRole("button", { name: "Ada Lovelace" }));

    const card = screen.getByTestId("chat-participant-hover-card");
    expect(card).toHaveTextContent("Ada Lovelace");
    expect(card).toHaveTextContent("Human");
    expect(card).toHaveTextContent("ada@example.com");
    expect(card).toHaveTextContent("Online");
    expect(card).not.toHaveTextContent("AI coworker");
  });

  it("shows coworker caption, slug fallback, and AI badge", async () => {
    const user = userEvent.setup();
    render(
      <ChatParticipantHoverCard profile={coworkerProfile}>
        <span>Hannah</span>
      </ChatParticipantHoverCard>,
    );

    await user.hover(screen.getByRole("button", { name: "Hannah" }));

    const card = screen.getByTestId("chat-participant-hover-card");
    expect(card).toHaveTextContent("Hannah");
    expect(card).toHaveTextContent("AI coworker");
    expect(card).toHaveTextContent("Research assistant");
    expect(card).toHaveTextContent("Away");
    expect(card).not.toHaveTextContent("@hannah");
  });

  it("falls back to @slug when coworker caption is empty", async () => {
    const user = userEvent.setup();
    render(
      <ChatParticipantHoverCard profile={{ ...coworkerProfile, caption: null }}>
        <span>Hannah</span>
      </ChatParticipantHoverCard>,
    );

    await user.hover(screen.getByRole("button", { name: "Hannah" }));

    expect(screen.getByTestId("chat-participant-hover-card")).toHaveTextContent(
      "@hannah",
    );
  });

  it("renders children only when profile is missing", () => {
    render(
      <ChatParticipantHoverCard profile={null}>
        <span>No card</span>
      </ChatParticipantHoverCard>,
    );

    expect(screen.getByText("No card")).toBeInTheDocument();
    expect(
      screen.queryByTestId("chat-participant-hover-card"),
    ).not.toBeInTheDocument();
  });
});
