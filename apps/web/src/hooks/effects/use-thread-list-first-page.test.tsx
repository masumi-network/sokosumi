import type { ChatRoomThread } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listThreadsMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/chat/actions", () => ({
  listThreadsAction: listThreadsMock,
}));

import { useThreadListFirstPage } from "./use-thread-list-first-page";

const LABELS = { error: "Could not load threads" };

function Probe({ roomId }: { roomId: string }) {
  const { items, nextCursor, error, isLoading } = useThreadListFirstPage(
    roomId,
    LABELS,
  );
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="cursor">{nextCursor ?? ""}</span>
      <span data-testid="items">
        {items.map((t) => t.parentMessage.id).join(",")}
      </span>
    </div>
  );
}

describe("useThreadListFirstPage", () => {
  beforeEach(() => {
    listThreadsMock.mockReset();
  });

  it("loads the first page of threads, ignores stale results across room switches, and surfaces errors", async () => {
    const first = Promise.withResolvers<{
      ok: true;
      value: { threads: ChatRoomThread[]; nextCursor: string | null };
    }>();
    listThreadsMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [{ parentMessage: { id: "p2" } }] as ChatRoomThread[],
          nextCursor: "c2",
        },
      })
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } });

    const { rerender, unmount } = render(<Probe roomId="room-1" />);
    rerender(<Probe roomId="room-2" />);

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("items")).toHaveTextContent("p2");
    expect(screen.getByTestId("cursor")).toHaveTextContent("c2");

    // Stale room-1 response must not overwrite room-2.
    await act(async () => {
      first.resolve({
        ok: true,
        value: {
          threads: [{ parentMessage: { id: "p1" } }] as ChatRoomThread[],
          nextCursor: null,
        },
      });
      await first.promise;
    });
    expect(screen.getByTestId("items")).toHaveTextContent("p2");

    rerender(<Probe roomId="room-3" />);
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("boom"),
    );
    expect(screen.getByTestId("items")).toHaveTextContent("");

    unmount();
  });
});
