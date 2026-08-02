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
      openDirectMessage: "Message",
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
    expect(card).not.toHaveTextContent("Online");
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
    expect(card).not.toHaveTextContent("Away");
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

  it("shows Message for another human when human directs are available", () => {
    render(
      <ChatParticipantHoverCard
        profile={humanProfile}
        currentUserId="user-2"
        canOpenHumanDirect
        onOpenDirect={vi.fn()}
      >
        <span>Ada Lovelace</span>
      </ChatParticipantHoverCard>,
    );

    expect(screen.getByRole("button", { name: "Message" })).toBeInTheDocument();
  });

  it("hides Message for the current human user", () => {
    render(
      <ChatParticipantHoverCard
        profile={humanProfile}
        currentUserId={humanProfile.id}
        canOpenHumanDirect
        onOpenDirect={vi.fn()}
      >
        <span>Ada Lovelace</span>
      </ChatParticipantHoverCard>,
    );

    expect(
      screen.queryByRole("button", { name: "Message" }),
    ).not.toBeInTheDocument();
  });

  it("shows Message for a coworker without human direct access", () => {
    render(
      <ChatParticipantHoverCard
        profile={coworkerProfile}
        currentUserId="user-1"
        onOpenDirect={vi.fn()}
      >
        <span>Hannah</span>
      </ChatParticipantHoverCard>,
    );

    expect(screen.getByRole("button", { name: "Message" })).toBeInTheDocument();
  });

  it("calls onOpenDirect with the participant", async () => {
    const user = userEvent.setup();
    const onOpenDirect = vi.fn();
    render(
      <ChatParticipantHoverCard
        profile={coworkerProfile}
        onOpenDirect={onOpenDirect}
      >
        <span>Hannah</span>
      </ChatParticipantHoverCard>,
    );

    await user.click(screen.getByRole("button", { name: "Message" }));

    expect(onOpenDirect).toHaveBeenCalledWith(coworkerProfile);
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
