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
    isGroupDirect: false,
    groupName: null,
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
          isGroupDirect: false,
          groupName: null,
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
    expect(
      within(screen.getByTestId("dm-sidebar-avatar-alice")).queryByText(
        "Online",
      ),
    ).toBeNull();
    expect(screen.getByTestId("dm-sidebar-avatar-bob")).toBeInTheDocument();
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

  it("draws one 20px face in every state, so the row's mark never resizes", () => {
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
    expect(emptyTokens).toContain("size-5");
    expect(emptyTokens).toContain("shrink-0");
    expect(emptyContainer.firstElementChild?.className).not.toContain(
      "group-data-[collapsible=icon]:",
    );
    unmount();

    const { container } = render(
      <DirectRoomAvatarStack room={makeDirectRoom()} currentUserId="me" />,
    );

    const face = container.querySelector('[data-slot="avatar"]');
    expect(face?.className.split(" ")).toContain("size-5");
    expect(face?.className).not.toContain("group-data-[collapsible=icon]:");
  });

  it("stacks up to three faces and keeps only the first on the rail", () => {
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

    // One face cannot say "several people are in here" — it reads as a direct
    // with whoever that is. The stack grows the row's slot to the right off a
    // fixed left edge, so the first face stays on the 28px axis and only this
    // row's name starts later.
    const first = screen.getByTestId("dm-sidebar-avatar-alice");
    const second = screen.getByTestId("dm-sidebar-avatar-bob");
    expect(first.className.split(/\s+/)).not.toContain("-ml-1.5");
    expect(second.className.split(/\s+/)).toContain("-ml-1.5");
    // The first face on top, so its presence dot is not buried under the
    // one beside it.
    expect(Number(first.style.zIndex)).toBeGreaterThan(
      Number(second.style.zIndex),
    );

    // A 32px rail square cannot hold three of them, and the row's tooltip
    // already names everyone.
    expect(first.className).not.toContain("group-data-[collapsible=icon]:");
    expect(second.className.split(/\s+/)).toContain(
      "group-data-[collapsible=icon]:hidden",
    );
  });

  it("pads a stack so its first face lands where a lone face does", () => {
    // The slot centres a mark narrower than itself, so a lone 20px face sits
    // 2px in while a stack — wider than the slot — starts flush at its edge.
    // Without the padding a group row's first face would sit 2px left of
    // every 1:1 face under it, and those are the same shape in one column.
    const { container: single, unmount } = render(
      <DirectRoomAvatarStack room={makeDirectRoom()} currentUserId="me" />,
    );
    expect(single.firstElementChild?.className.split(/\s+/)).not.toContain(
      "pl-0.5",
    );
    unmount();

    const { container: stacked } = render(
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
    expect(stacked.firstElementChild?.className.split(/\s+/)).toContain(
      "pl-0.5",
    );
    // Extra faces are `display: none` on the rail, so the stack is one 20px
    // face again. Leaving the pad would centre a 22px mark and sit 1px off
    // every 1:1 face in that column.
    expect(stacked.firstElementChild?.className.split(/\s+/)).toContain(
      "group-data-[collapsible=icon]:pl-0",
    );
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
