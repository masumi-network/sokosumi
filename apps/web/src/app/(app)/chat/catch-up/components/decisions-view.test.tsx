import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";

import { DecisionsView } from "./decisions-view";

const { liveRooms, listMock, correctMock, toastMock } = vi.hoisted(() => ({
  liveRooms: { current: null as ChatRoom[] | null },
  listMock: vi.fn(),
  correctMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/chat/signal-actions", () => ({
  listChatDecisionsAction: listMock,
  correctChatSignalTagAction: correctMock,
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

  it("tells how to fix a wrong decision only when one is listed", () => {
    const note = /choose “Not a decision”/;
    const { rerender } = render(view({ messages: [], nextCursor: null }));
    expect(screen.queryByText(note)).toBeNull();

    rerender(view(null));
    expect(screen.queryByText(note)).toBeNull();

    rerender(
      view({
        messages: [decision("m-1", "We launch Monday")],
        nextCursor: null,
      }),
    );
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it("explains an empty list and a failed read", () => {
    const { rerender } = render(view({ messages: [], nextCursor: null }));
    const empty = screen.getByTestId("decisions-empty");
    expect(empty).toHaveTextContent("No decisions yet");
    expect(empty).toHaveTextContent(
      "We find them in channels and in chats with other people who allow it.",
    );

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

  it("takes a decision out with Not a decision, removing only that tag", async () => {
    const user = userEvent.setup();
    correctMock.mockResolvedValue({ ok: true, value: decision("m-1", "x") });
    render(
      view({
        messages: [
          decision("m-1", "We launch Monday"),
          decision("m-2", "Blue, not orange"),
        ],
        nextCursor: null,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Not a decision: We launch Monday" }),
    );

    expect(correctMock).toHaveBeenCalledExactlyOnceWith(
      "m-1",
      "decisionMade",
      false,
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /We launch Monday/ }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /Blue, not orange/ }),
    ).toBeInTheDocument();
  });

  it("keeps the row and says so when the change fails", async () => {
    const user = userEvent.setup();
    correctMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Could not save" },
    });
    render(
      view({
        messages: [decision("m-1", "We launch Monday")],
        nextCursor: null,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Not a decision: We launch Monday" }),
    );

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Could not save");
    });
    expect(
      screen.getByRole("link", { name: /We launch Monday/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Not a decision: We launch Monday" }),
    ).toBeEnabled();
  });

  it("offers Not a decision only in rooms the reader is in", () => {
    render(
      view(
        {
          messages: [
            decision("m-1", "We launch Monday"),
            decision("m-2", "Blue, not orange", { roomId: "room-gone" }),
          ],
          nextCursor: null,
        },
        [design],
      ),
    );

    expect(
      screen.getByRole("button", { name: "Not a decision: We launch Monday" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Not a decision: Blue, not orange",
      }),
    ).toBeNull();
  });

  it("frees the button and says so when the request itself fails, then retries", async () => {
    const user = userEvent.setup();
    correctMock.mockRejectedValueOnce(new Error("offline"));
    correctMock.mockResolvedValueOnce({
      ok: true,
      value: decision("m-1", "We launch Monday"),
    });
    render(
      view({
        messages: [decision("m-1", "We launch Monday")],
        nextCursor: null,
      }),
    );
    const button = screen.getByRole("button", {
      name: "Not a decision: We launch Monday",
    });

    await user.click(button);
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Couldn't change that. Try again.",
      );
    });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy", "true");

    await user.click(button);
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /We launch Monday/ }),
      ).not.toBeInTheDocument();
    });
    expect(correctMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a row whose Decision tag another reader put back", async () => {
    const user = userEvent.setup();
    const stillDecision = {
      ...decision("m-1", "We launch Monday"),
      signal: {
        tags: ["decisionMade" as const],
        probabilities: {},
        addressedUserIds: [],
        commitmentDueAt: null,
        loopClosedAt: null,
        loopTaskId: null,
        correctedTags: ["decisionMade" as const],
      },
    };
    correctMock.mockResolvedValue({ ok: true, value: stillDecision });
    render(
      view({
        messages: [decision("m-1", "We launch Monday")],
        nextCursor: null,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Not a decision: We launch Monday" }),
    );

    await waitFor(() => expect(correctMock).toHaveBeenCalled());
    expect(
      screen.getByRole("link", { name: /We launch Monday/ }),
    ).toBeInTheDocument();
  });

  it("moves focus to the next row, then the previous, then the heading", async () => {
    const user = userEvent.setup();
    correctMock.mockImplementation(async (id: string) => ({
      ok: true,
      value: decision(id, "x"),
    }));
    render(
      view({
        messages: [
          decision("m-1", "First call"),
          decision("m-2", "Second call"),
          decision("m-3", "Third call"),
        ],
        nextCursor: null,
      }),
    );
    const notDecision = (preview: string) =>
      screen.getByRole("button", { name: `Not a decision: ${preview}` });

    await user.click(notDecision("First call"));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Second call/ })).toHaveFocus();
    });

    await user.click(notDecision("Third call"));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Second call/ })).toHaveFocus();
    });

    await user.click(notDecision("Second call"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Decisions" })).toHaveFocus();
    });
  });
});
