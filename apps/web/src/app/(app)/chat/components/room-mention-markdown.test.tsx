import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { REGRESSION } from "@/components/mermaid/__tests__/regression";
import type { ChatRoomCoworkerParticipant } from "@/lib/clients/generated/core";
import { RoomMessageMarkdown } from "./room-mention-markdown";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      coworkerBadge: "AI coworker",
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
    expect(within(card).getByLabelText("AI coworker")).toBeInTheDocument();
    expect(card).toHaveTextContent("Message");
  });

  it("keeps the mention chip mounted when parent lookups change", () => {
    const props = {
      content: `@${coworker.id}:${coworker.slug} please look`,
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
    };
    const { rerender } = render(
      <RoomMessageMarkdown {...props} openingDirectParticipantKey={null} />,
    );
    const chip = screen.getByRole("button", { name: "Elena" });

    rerender(
      <RoomMessageMarkdown
        {...props}
        openingDirectParticipantKey="coworker:cow_1"
      />,
    );

    expect(screen.getByRole("button", { name: "Elena" })).toBe(chip);
  });

  it("survives a blank-to-nonblank rerender", () => {
    const maps = {
      coworkersById: new Map([[coworker.id, coworker]]),
      coworkersBySlug: new Map([[coworker.slug, coworker]]),
    };
    const { rerender } = render(
      <RoomMessageMarkdown content="   " {...maps} />,
    );

    rerender(
      <RoomMessageMarkdown
        content={`@${coworker.id}:${coworker.slug} please look`}
        {...maps}
      />,
    );

    expect(screen.getByRole("button", { name: "Elena" })).toBeInTheDocument();
  });
});

vi.mock("@/components/mermaid/mermaid-block", () => ({
  MermaidBlock: ({ source }: { source: string }) => <figure>{source}</figure>,
}));

describe("room Mermaid opt-in", () => {
  const props = {
    content: `\`\`\`mermaid\n${REGRESSION}\n\`\`\``,
    coworkersById: new Map<string, ChatRoomCoworkerParticipant>(),
    coworkersBySlug: new Map<string, ChatRoomCoworkerParticipant>(),
  };
  it("preserves the regression through room formatting", () => {
    const { container } = render(
      <RoomMessageMarkdown {...props} enableMermaid />,
    );
    expect(container.querySelector("figure")?.textContent).toBe(REGRESSION);
  });
  it("keeps quoted/composer previews free of diagram controls", () => {
    const { container } = render(<RoomMessageMarkdown {...props} />);
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("pre")).toHaveTextContent("flowchart LR");
  });
});
