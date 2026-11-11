import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";

import { DecisionsView } from "./decisions-view";

const { liveRooms, listMock, toastMock } = vi.hoisted(() => ({
  liveRooms: { current: null as ChatRoom[] | null },
  listMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/chat/signal-actions", () => ({
  listChatDecisionsAction: listMock,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => liveRooms.current,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const design = makeRoom({ id: "room-design", name: "design" });
const marketing = makeRoom({ id: "room-marketing", name: "marketing" });

function decision(
  id: string,
  content: string,
  options: { roomId?: string; parentMessageId?: string } = {},
): ChatRoomMessage {
  return {
    id,
    roomId: options.roomId ?? "room-design",
    parentMessageId: options.parentMessageId ?? null,
    content,
    createdAt: new Date("2026-11-08T09:00:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-2",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

type Page = Parameters<typeof DecisionsView>[0]["initialPage"];

function view(
  initialPage: Page,
  initialRooms: ChatRoom[] = [design, marketing],
) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <DecisionsView
        initialPage={initialPage}
        initialRooms={initialRooms}
        currentUserId="user-1"
      />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  liveRooms.current = null;
});

describe("DecisionsView", () => {
  it("links each decision to its message and names its room", () => {
    render(
      view({
        messages: [
          decision("m-1", "We launch Monday"),
          decision("m-2", "Blue, not orange", {
            roomId: "room-marketing",
            parentMessageId: "m-0",
          }),
        ],
        nextCursor: null,
      }),
    );

    const launch = screen.getByRole("link", { name: /We launch Monday/ });
    expect(launch).toHaveAttribute(
      "href",
      "/chat/rooms/room-design?message=m-1",
    );
    expect(launch).toHaveTextContent("Ada");
    expect(launch).toHaveTextContent("#design");
    expect(launch).not.toHaveTextContent("In a thread");

    const reply = screen.getByRole("link", { name: /Blue, not orange/ });
    expect(reply).toHaveAttribute(
      "href",
      "/chat/rooms/room-marketing?message=m-2",
    );
    expect(reply).toHaveTextContent("#marketing · In a thread");
  });

  it("explains an empty list and a failed read", () => {
    const { rerender } = render(view({ messages: [], nextCursor: null }));
    expect(screen.getByTestId("decisions-empty")).toBeInTheDocument();

    rerender(view(null));
    expect(screen.getByText("Could not load decisions.")).toBeInTheDocument();
  });

  it("loads older decisions from the cursor", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      ok: true,
      value: {
        messages: [decision("m-2", "Annual plan only")],
        nextCursor: null,
      },
    });
    render(
      view({
        messages: [decision("m-1", "We launch Monday")],
        nextCursor: "c-1",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Load older" }));

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Annual plan only/ }),
      ).toBeInTheDocument();
    });
    expect(listMock).toHaveBeenCalledExactlyOnceWith("c-1");
    expect(
      screen.queryByRole("button", { name: "Load older" }),
    ).not.toBeInTheDocument();
  });

  it("drops a decision whose room left the sidebar", () => {
    liveRooms.current = [design];
    render(
      view({
        messages: [
          decision("m-1", "We launch Monday"),
          decision("m-2", "Blue, not orange", { roomId: "room-marketing" }),
        ],
        nextCursor: null,
      }),
    );

    expect(
      screen.getByRole("link", { name: /We launch Monday/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Blue, not orange/ }),
    ).not.toBeInTheDocument();
  });
  it("drops a decision when its room leaves the live sidebar after render", () => {
    liveRooms.current = [design, marketing];
    const page = {
      messages: [
        decision("m-1", "We launch Monday"),
        decision("m-2", "Blue, not orange", { roomId: "room-marketing" }),
      ],
      nextCursor: null,
    };
    const { rerender } = render(view(page));
    expect(
      screen.getByRole("link", { name: /Blue, not orange/ }),
    ).toBeInTheDocument();

    liveRooms.current = [design];
    rerender(view(page));
    expect(
      screen.queryByRole("link", { name: /Blue, not orange/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /We launch Monday/ }),
    ).toBeInTheDocument();

    // A workspace switch drops the live rooms: nothing of the old scope stays,
    // and the page's own first rooms do not come back.
    liveRooms.current = null;
    rerender(view(page));
    expect(
      screen.queryByRole("link", { name: /We launch Monday/ }),
    ).not.toBeInTheDocument();
  });

  it("ignores an older page that lands after the first page was replaced", async () => {
    const user = userEvent.setup();
    let resolveOld: (value: unknown) => void = () => {};
    listMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const { rerender } = render(
      view({
        messages: [decision("m-1", "We launch Monday")],
        nextCursor: "c-old",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Load older" }));

    // The server sends a new first page (workspace switch, refresh).
    rerender(
      view({
        messages: [decision("m-9", "New scope decision")],
        nextCursor: "c-new",
      }),
    );
    expect(
      screen.queryByRole("link", { name: /We launch Monday/ }),
    ).not.toBeInTheDocument();

    resolveOld({
      ok: true,
      value: {
        messages: [decision("m-2", "Old scope older")],
        nextCursor: null,
      },
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load older" }),
      ).not.toBeDisabled();
    });
    expect(
      screen.queryByRole("link", { name: /Old scope older/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /New scope decision/ }),
    ).toBeInTheDocument();

    // The next Load older uses the new page's cursor, not the old one.
    listMock.mockResolvedValueOnce({
      ok: true,
      value: { messages: [], nextCursor: null },
    });
    await user.click(screen.getByRole("button", { name: "Load older" }));
    expect(listMock).toHaveBeenLastCalledWith("c-new");
  });
});
