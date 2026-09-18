import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoom } from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      "Presence.online": "Online",
      "Presence.afk": "Away",
      "Presence.offline": "Offline",
    };
    return labels[key] ?? key;
  },
}));

// Radix mounts hover-card content only once open, so an unmocked wrapper
// would leave no trace in a static render. Mock it to always leave one.
vi.mock("@/app/chat/components/chat-participant-hover-card", () => ({
  ChatParticipantHoverCard: () => (
    <div data-testid="chat-participant-hover-card" />
  ),
}));

import { DirectRoomAvatarStack } from "./direct-room-avatar-stack";

function makeUser(id: string, name?: string) {
  return {
    id,
    name: name ?? `User ${id}`,
    email: `${id}@example.com`,
    image: null as string | null,
    presence: "online" as const,
  };
}

function makeSokoBot(id: string, name: string) {
  return {
    id,
    name,
    caption: `${name} caption`,
    image: null as string | null,
    avatarSeed: null as string | null,
    presence: "offline" as const,
  };
}

function makeDirectRoom(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "dm-1",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "dm",
    slug: "dm",
    kind: "direct",
    isSelfDirect: false,
    directKey: "key",
    topic: null,
    discoverability: "private",
    createdByUserId: "me",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [makeUser("me", "Me"), makeUser("patrick", "Patrick Tobler")],
    coworkerMembers: [],
    ...overrides,
    sokoBotMembers: overrides.sokoBotMembers ?? [],
  };
}

describe("DirectRoomAvatarStack", () => {
  it("shows the owner's avatar without presence for Self Direct", () => {
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({
          isSelfDirect: true,
          userMembers: [makeUser("me", "Me")],
        })}
        currentUserId="me"
      />,
    );
    expect(screen.getByTestId("dm-sidebar-avatar-me")).toBeInTheDocument();
    expect(screen.queryByText("Online")).toBeNull();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("states availability on a 1:1 row and stays silent on a group row", () => {
    const { unmount } = render(
      <DirectRoomAvatarStack room={makeDirectRoom()} currentUserId="me" />,
    );

    // A two-person direct gets no roster panel, so this row is the only place
    // availability can reach a screen reader at all. Assert it is reachable,
    // not merely in the DOM: getByText finds text inside aria-hidden too.
    const solo = screen.getByTestId("dm-sidebar-avatar-patrick");
    expect(
      within(solo).getByText("Online").closest("[aria-hidden]"),
    ).toBeNull();
    unmount();

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
      />,
    );

    // A group row's label already lists these people, so per-face states would
    // make the link speak every name twice. The roster panel reports there.
    // The dot goes with the text: one dot among three people reads as the
    // room's state rather than Alice's.
    const group = screen.getByTestId("dm-sidebar-avatar-alice");
    expect(within(group).queryByText("Online")).toBeNull();
    expect(group.querySelector("[title]")).toBeNull();
  });

  it("renders faces as plain marks with no hover card or button semantics", () => {
    render(
      <DirectRoomAvatarStack room={makeDirectRoom()} currentUserId="me" />,
    );

    // The row link is the direct itself, so a face must not carry its own
    // activation or open a card over the room it already points at. The
    // mocked wrapper always renders its test id, so absence means the stack
    // no longer imports it at all.
    const avatar = screen.getByTestId("dm-sidebar-avatar-patrick");
    expect(avatar).not.toHaveAttribute("role");
    expect(avatar).not.toHaveAttribute("tabindex");
    expect(avatar).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("chat-participant-hover-card"),
    ).not.toBeInTheDocument();
  });

  it("reports a soko bot as online whatever its own presence says", () => {
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({
          userMembers: [makeUser("me", "Me")],
          sokoBotMembers: [makeSokoBot("bot-1", "Zero")],
        })}
        currentUserId="me"
      />,
    );

    // Soko bots are AI and report always-online (ADR-0003), same as coworkers.
    // Miss that arm and this mark says "Offline" while the roster panel says
    // "Online" for the same member. The mark is aria-hidden, so its tooltip is
    // where that state is observable.
    const face = screen.getByTestId("dm-sidebar-avatar-bot-1");
    expect(face.querySelector("[title]")?.getAttribute("title")).toBe("Online");
  });

  it("draws one 24px face in every state, so the row's mark never resizes", () => {
    const { container: emptyContainer, unmount } = render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({ userMembers: [makeUser("me", "Me")] })}
        currentUserId="me"
      />,
    );

    // An empty direct's mark is a face like any other, and the row's own
    // `SidebarRowSlot` is the box around it — nothing here sizes with state.
    const emptyTokens =
      emptyContainer.firstElementChild?.className.split(" ") ?? [];
    expect(emptyTokens).toContain("size-6");
    expect(emptyTokens).toContain("shrink-0");
    expect(emptyContainer.firstElementChild?.className).not.toContain(
      "group-data-[collapsible=icon]:",
    );
    unmount();

    const { container } = render(
      <DirectRoomAvatarStack room={makeDirectRoom()} currentUserId="me" />,
    );

    const face = container.querySelector('[data-slot="avatar"]');
    expect(face?.className.split(" ")).toContain("size-6");
    expect(face?.className).not.toContain("group-data-[collapsible=icon]:");
  });

  it("shows one face however many people are in the room", () => {
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
      />,
    );

    // A **Sidebar row**'s mark is one 24px slot (CONTEXT.md), and a stack is
    // not: three 24px faces overlapping run 56px, which spilled out of the
    // slot and over the name beside it. Shrinking them to fit would turn a
    // group into three coloured dots, which is why Soko Bots stopped stacking
    // too. The room's label lists everyone in this same order.
    expect(screen.getByTestId("dm-sidebar-avatar-alice")).toBeInTheDocument();
    for (const id of ["bob", "me"]) {
      expect(screen.queryByTestId(`dm-sidebar-avatar-${id}`)).toBeNull();
    }
    expect(document.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1);
  });

  it("renders a fallback mark when the DM has no other participants", () => {
    render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({
          userMembers: [makeUser("me", "Me")],
          coworkerMembers: [],
        })}
        currentUserId="me"
      />,
    );

    expect(
      screen.queryByTestId("dm-sidebar-avatar-me"),
    ).not.toBeInTheDocument();
  });
});
