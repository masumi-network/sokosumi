import type { ChatRoomPinnedMessageListItem } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listPinnedMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/chat/actions", () => ({
  listPinnedMessagesAction: listPinnedMock,
}));

import { usePinnedMessagesList } from "./use-pinned-messages-list";

const LABELS = { error: "Could not load pins" };

function Probe({
  roomId,
  listGeneration,
}: {
  roomId: string;
  listGeneration: number;
}) {
  const { loadedItems, nextCursor, isLoading, error } = usePinnedMessagesList(
    roomId,
    listGeneration,
    LABELS,
  );
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="cursor">{nextCursor ?? ""}</span>
      <span data-testid="items">
        {loadedItems.map((i) => i.messageId).join(",")}
      </span>
    </div>
  );
}

describe("usePinnedMessagesList", () => {
  beforeEach(() => {
    listPinnedMock.mockReset();
  });

  it("loads pinned messages, reloads on listGeneration bump, and reports errors", async () => {
    listPinnedMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          items: [{ messageId: "m1" }] as ChatRoomPinnedMessageListItem[],
          nextCursor: "c1",
        },
      })
      .mockResolvedValueOnce({ ok: false, error: { message: "bad" } });

    const { rerender, unmount } = render(
      <Probe roomId="room-1" listGeneration={0} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("items")).toHaveTextContent("m1");
    expect(screen.getByTestId("cursor")).toHaveTextContent("c1");

    rerender(<Probe roomId="room-1" listGeneration={1} />);
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(LABELS.error),
    );
    expect(screen.getByTestId("items")).toHaveTextContent("");
    expect(screen.getByTestId("cursor")).toHaveTextContent("");

    unmount();
  });
});
