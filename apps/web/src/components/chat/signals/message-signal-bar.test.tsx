import type { ChatRoomMessage, ChatSignalTag } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

import { MessageSignalBar } from "./message-signal-bar";

const { touch, correctMock } = vi.hoisted(() => ({
  touch: { current: false },
  correctMock: vi.fn(),
}));

vi.mock("@/hooks/effects/use-media-query", () => ({
  useMediaQuery: () => touch.current,
}));
vi.mock("@/app/chat/signal-actions", () => ({
  correctChatSignalTagAction: correctMock,
  setChatSignalLoopAction: vi.fn(),
  suggestChatCoworkersAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function tagged(tags: ChatSignalTag[]): ChatRoomMessage {
  return {
    id: "m-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "We launch Monday",
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
    signal: {
      tags,
      probabilities: {},
      addressedUserIds: [],
      commitmentDueAt: null,
      loopClosedAt: null,
      loopTaskId: null,
      correctedTags: [],
    },
  };
}

function bar(message: ChatRoomMessage) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <MessageSignalBar message={message} currentUserId="user-1" />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  touch.current = false;
});

describe("MessageSignalBar on a touch screen", () => {
  it("opens the tag's actions on a tap, and the tap alone keeps the tag", async () => {
    touch.current = true;
    const user = userEvent.setup();
    render(bar(tagged(["decisionMade", "announcement"])));

    expect(
      screen.queryByRole("button", { name: "Remove tag: Decision" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Decision" }));

    const sheet = await screen.findByRole("dialog", { name: "Decision tag" });
    expect(sheet).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open in Decisions" }),
    ).toHaveAttribute("href", "/chat/catch-up/decisions");
    expect(correctMock).not.toHaveBeenCalled();
  });

  it("removes only that tag from the sheet", async () => {
    touch.current = true;
    const user = userEvent.setup();
    const message = tagged(["decisionMade", "announcement"]);
    correctMock.mockResolvedValue({
      ok: true,
      value: {
        ...message,
        signal: { ...message.signal, tags: ["announcement"] },
      },
    });
    render(bar(message));

    await user.click(screen.getByRole("button", { name: "Decision" }));
    await user.click(await screen.findByRole("button", { name: "Remove tag" }));

    expect(correctMock).toHaveBeenCalledExactlyOnceWith(
      "m-1",
      "decisionMade",
      false,
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Decision" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Announcement" }),
    ).toBeInTheDocument();
  });

  it("offers Open in Decisions only on a Decision tag", async () => {
    touch.current = true;
    const user = userEvent.setup();
    render(bar(tagged(["announcement"])));

    await user.click(screen.getByRole("button", { name: "Announcement" }));

    expect(
      await screen.findByRole("button", { name: "Remove tag" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open in Decisions" }),
    ).toBeNull();
  });

  it("keeps the × on a pointer screen", () => {
    render(bar(tagged(["decisionMade"])));

    expect(
      screen.getByRole("button", { name: "Remove tag: Decision" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decision" })).toBeNull();
  });

  it("gives focus back to the chip when the sheet closes without a change", async () => {
    touch.current = true;
    const user = userEvent.setup();
    render(bar(tagged(["decisionMade"])));
    const chip = screen.getByRole("button", { name: "Decision" });

    await user.click(chip);
    await screen.findByRole("dialog", { name: "Decision tag" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(chip).toHaveFocus();

    await user.click(chip);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(chip).toHaveFocus();
    expect(correctMock).not.toHaveBeenCalled();
  });

  it("moves focus to the tag button once the tag is removed", async () => {
    touch.current = true;
    const user = userEvent.setup();
    const message = tagged(["decisionMade", "announcement"]);
    correctMock.mockResolvedValue({
      ok: true,
      value: {
        ...message,
        signal: { ...message.signal, tags: ["announcement"] },
      },
    });
    render(bar(message));

    await user.click(screen.getByRole("button", { name: "Decision" }));
    await user.click(await screen.findByRole("button", { name: "Remove tag" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit tags" })).toHaveFocus();
    });
  });

  it("draws no drag handle on a sheet that cannot be dragged", async () => {
    touch.current = true;
    const user = userEvent.setup();
    render(bar(tagged(["decisionMade"])));

    await user.click(screen.getByRole("button", { name: "Decision" }));
    const sheet = await screen.findByRole("dialog", { name: "Decision tag" });
    expect(sheet.querySelector(".rounded-full")).toBeNull();
  });
});
