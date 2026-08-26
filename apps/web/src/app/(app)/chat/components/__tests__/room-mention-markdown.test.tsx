import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoomCoworkerParticipant } from "@/lib/clients/generated/core";
import { RoomMessageMarkdown } from "../room-mention-markdown";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      coworkerBadge: "AI coworker",
      humanBadge: "Human",
      openDirectMessage: "Message",
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

const coworker: ChatRoomCoworkerParticipant = {
  id: "cow_1",
  name: "Elena",
  slug: "elena",
  caption: "Research assistant",
  image: null,
  presence: "online",
};

describe("RoomMessageMarkdown mention hover", () => {
  it("shows the participant card and Message on a resolved coworker chip", async () => {
    const user = userEvent.setup();
    const onOpenDirect = vi.fn();
    render(
      <RoomMessageMarkdown
        content={`@${coworker.id}:${coworker.slug} please look`}
        coworkersById={new Map([[coworker.id, coworker]])}
        coworkersBySlug={new Map([[coworker.slug, coworker]])}
        onOpenDirectMessage={onOpenDirect}
        canOpenHumanDirect
      />,
    );

    await user.hover(screen.getByRole("button", { name: "Elena" }));

    const card = screen.getByTestId("chat-participant-hover-card");
    expect(card).toHaveTextContent("Elena");
    expect(card).toHaveTextContent("AI coworker");
    expect(card).toHaveTextContent("Message");
  });
});
