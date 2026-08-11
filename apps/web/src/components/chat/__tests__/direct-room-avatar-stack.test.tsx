import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRoom } from "@/lib/clients/generated/core";

const { openDirectMock, pushMock } = vi.hoisted(() => ({
  openDirectMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

vi.mock("@/components/chat/live-member-presence-dot", () => ({
  LiveMemberPresenceDot: () => <span data-testid="presence-dot" />,
}));

vi.mock("@/app/chat/components/open-direct-with-participant", () => ({
  participantDirectKey: (profile: { kind: string; id: string }) =>
    `${profile.kind}:${profile.id}`,
  canShowOpenDirect: ({
    profile,
    currentUserId,
    canOpenHumanDirect,
    onOpenDirect,
  }: {
    profile: { kind: string; id: string };
    currentUserId?: string;
    canOpenHumanDirect: boolean;
    onOpenDirect?: unknown;
  }) => {
    if (!onOpenDirect) return false;
    if (profile.kind === "human") {
      if (!canOpenHumanDirect) return false;
      if (currentUserId && profile.id === currentUserId) return false;
    }
    return true;
  },
  openDirectWithParticipant: (...args: unknown[]) => openDirectMock(...args),
}));

import { DirectRoomAvatarStack } from "../direct-room-avatar-stack";

function makeUser(id: string, name?: string) {
  return {
    id,
    name: name ?? `User ${id}`,
    email: `${id}@example.com`,
    image: null as string | null,
    presence: "online" as const,
  };
}

function makeCoworker(id: string, name: string, slug: string) {
  return {
    id,
    name,
    slug,
    caption: `${name} caption`,
    image: null as string | null,
    presence: "online" as const,
  };
}

function makeDirectRoom(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "dm-1",
    organizationId: "org-1",
    name: "dm",
    slug: "dm",
    kind: "direct",
    directKey: "key",
    topic: null,
    discoverability: "private",
    createdByUserId: "me",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    userMembers: [makeUser("me", "Me"), makeUser("patrick", "Patrick Tobler")],
    coworkerMembers: [],
    ...overrides,
  };
}

describe("DirectRoomAvatarStack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openDirectMock.mockResolvedValue({ ok: true, roomId: "dm-2" });
  });

  it("shows participant hover card for a 1:1 human DM avatar", async () => {
    const user = userEvent.setup();
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom()}
        currentUserId="me"
        canOpenHumanDirect
        selectedRoomId={null}
      />,
    );

    await user.hover(screen.getByLabelText("Patrick Tobler"));

    const card = screen.getByTestId("chat-participant-hover-card");
    expect(card).toHaveTextContent("Patrick Tobler");
    expect(card).toHaveTextContent("Human");
    expect(card).toHaveTextContent("patrick@example.com");
  });

  it("shows a hover card per stacked participant in a group DM", () => {
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({
          userMembers: [
            makeUser("me", "Me"),
            makeUser("alice", "Alice"),
            makeUser("bob", "Bob"),
          ],
        })}
        currentUserId="me"
        canOpenHumanDirect
        selectedRoomId={null}
      />,
    );

    // HoverCard is mocked open so each stacked avatar mounts its card.
    const cards = screen.getAllByTestId("chat-participant-hover-card");
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.textContent).join(" ")).toContain("Alice");
    expect(cards.map((card) => card.textContent).join(" ")).toContain("Bob");
    expect(screen.getByLabelText("Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Bob")).toBeInTheDocument();
  });

  it("shows coworker hover card with caption and Message action", async () => {
    const user = userEvent.setup();
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({
          userMembers: [makeUser("me", "Me")],
          coworkerMembers: [makeCoworker("cw-1", "Matt", "matt")],
        })}
        currentUserId="me"
        canOpenHumanDirect={false}
        selectedRoomId={null}
      />,
    );

    await user.hover(screen.getByLabelText("Matt"));

    const card = screen.getByTestId("chat-participant-hover-card");
    expect(card).toHaveTextContent("Matt");
    expect(card).toHaveTextContent("AI coworker");
    expect(card).toHaveTextContent("Matt caption");
    expect(
      screen.getByRole("button", { name: /Message/i }),
    ).toBeInTheDocument();
  });

  it("opens a direct when Message is clicked from the hover card", async () => {
    const user = userEvent.setup();
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom()}
        currentUserId="me"
        canOpenHumanDirect
        selectedRoomId="dm-1"
      />,
    );

    await user.hover(screen.getByLabelText("Patrick Tobler"));
    await user.click(screen.getByRole("button", { name: /Message/i }));

    expect(openDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          kind: "human",
          id: "patrick",
          name: "Patrick Tobler",
        }),
        selectedRoomId: "dm-1",
      }),
    );
  });

  it("renders a non-interactive fallback when the DM has no other participants", () => {
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({
          userMembers: [makeUser("me", "Me")],
          coworkerMembers: [],
        })}
        currentUserId="me"
        canOpenHumanDirect
        selectedRoomId={null}
      />,
    );

    expect(
      screen.queryByTestId("chat-participant-hover-card"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Me")).not.toBeInTheDocument();
  });
});
