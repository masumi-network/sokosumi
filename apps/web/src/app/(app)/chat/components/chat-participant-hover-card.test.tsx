import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { OrganizationSeatProvider } from "@/contexts/organization-seat-context";

import { ChatParticipantHoverCard } from "./chat-participant-hover-card";
import type { ChatParticipantHoverProfile } from "./room-helpers";

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
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <ChatParticipantHoverCard
          profile={coworkerProfile}
          currentUserId="user-1"
          onOpenDirect={vi.fn()}
        >
          <span>Hannah</span>
        </ChatParticipantHoverCard>
      </OrganizationSeatProvider>,
    );

    expect(screen.getByRole("button", { name: "Message" })).toBeInTheDocument();
  });

  it("calls onOpenDirect with the participant", async () => {
    const user = userEvent.setup();
    const onOpenDirect = vi.fn();
    render(
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <ChatParticipantHoverCard
          profile={coworkerProfile}
          onOpenDirect={onOpenDirect}
        >
          <span>Hannah</span>
        </ChatParticipantHoverCard>
      </OrganizationSeatProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Message" }));

    expect(onOpenDirect).toHaveBeenCalledWith(coworkerProfile);
  });

  it("disables Message while another direct open is busy", () => {
    render(
      <OrganizationSeatProvider hasAssignedSeat={true}>
        <ChatParticipantHoverCard
          profile={coworkerProfile}
          onOpenDirect={vi.fn()}
          isDirectActionBusy
        >
          <span>Hannah</span>
        </ChatParticipantHoverCard>
      </OrganizationSeatProvider>,
    );

    expect(screen.getByRole("button", { name: "Message" })).toBeDisabled();
  });

  it("names the avatar trigger with the participant name", () => {
    render(
      <ChatParticipantHoverCard profile={humanProfile}>
        <span>avatar</span>
      </ChatParticipantHoverCard>,
    );

    expect(
      screen.getByRole("button", { name: "Ada Lovelace" }),
    ).toBeInTheDocument();
  });

  it("strips inherited focus semantics when interactive is false (nested in links)", () => {
    render(
      <ChatParticipantHoverCard profile={humanProfile} interactive={false}>
        <span
          data-testid="passive-trigger"
          role="button"
          tabIndex={0}
          aria-label="should-be-cleared"
        >
          avatar
        </span>
      </ChatParticipantHoverCard>,
    );

    const trigger = screen.getByTestId("passive-trigger");
    expect(trigger).not.toHaveAttribute("aria-label");
    expect(trigger).not.toHaveAttribute("role");
    expect(trigger).not.toHaveAttribute("tabindex");
    expect(
      screen.queryByRole("button", { name: "Ada Lovelace" }),
    ).not.toBeInTheDocument();
  });

  it("uses the child control itself as the hover trigger hit target", () => {
    render(
      <div className="flex" style={{ display: "flex", height: 400 }}>
        <ChatParticipantHoverCard
          profile={humanProfile}
          className="mt-0.5 shrink-0"
        >
          <span
            data-testid="avatar-hit-target"
            className="size-8"
            style={{ width: 32, height: 32, display: "block" }}
          />
        </ChatParticipantHoverCard>
        <div style={{ flex: 1 }}>tall message body</div>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Ada Lovelace" });
    expect(trigger).toHaveAttribute("data-testid", "avatar-hit-target");
    expect(trigger).toHaveClass("size-8");
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
