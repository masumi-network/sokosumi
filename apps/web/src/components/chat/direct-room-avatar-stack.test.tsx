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

  it("fits empty and 1:1 DM leadings in a min-w-5 / h-5 box matching channel icons", () => {
    const { container: emptyContainer, unmount } = render(
      <DirectRoomAvatarStack
        room={makeDirectRoom({ userMembers: [makeUser("me", "Me")] })}
        currentUserId="me"
      />,
    );

    const emptyRoot = emptyContainer.firstElementChild;
    expect(emptyRoot?.className).toContain("size-5");
    expect(emptyRoot?.className).toContain("shrink-0");
    unmount();

    const { container } = render(
      <DirectRoomAvatarStack room={makeDirectRoom()} currentUserId="me" />,
    );

    // min-w-5 / h-5 matches channel icon column; multi stacks may grow wider.
    const stackRoot = container.firstElementChild;
    expect(stackRoot?.className).toContain("min-w-5");
    expect(stackRoot?.className).toContain("h-5");
    expect(stackRoot?.className).toContain("shrink-0");
    expect(stackRoot?.className).toContain("items-center");
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
