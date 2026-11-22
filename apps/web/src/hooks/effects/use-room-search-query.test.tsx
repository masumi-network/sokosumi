import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMessagesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getChatRoomMessages: getMessagesMock },
}));

import { useRoomSearchQuery } from "./use-room-search-query";

const LABELS = { error: "Search failed" };

function Probe({
  roomId,
  open,
  debouncedQuery,
}: {
  roomId: string;
  open: boolean;
  debouncedQuery: string;
}) {
  const { results, error, isLoading, resetSearch } = useRoomSearchQuery(
    roomId,
    open,
    debouncedQuery,
    LABELS,
  );
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="results">{results.map((r) => r.id).join(",")}</span>
      <button type="button" onClick={() => resetSearch(false)}>
        reset
      </button>
    </div>
  );
}

describe("useRoomSearchQuery", () => {
  beforeEach(() => {
    getMessagesMock.mockReset();
  });

  it("fetches room search hits only when open with a query, drops stale responses, and handles errors", async () => {
    const first = Promise.withResolvers<{ data: ChatRoomMessage[] }>();
    getMessagesMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: [{ id: "m2" }] as ChatRoomMessage[] })
      .mockRejectedValueOnce(new Error("network"));

    const { rerender, unmount } = render(
      <Probe roomId="room-1" open={false} debouncedQuery="hi" />,
    );
    expect(getMessagesMock).not.toHaveBeenCalled();

    rerender(<Probe roomId="room-1" open={true} debouncedQuery="hi" />);
    expect(getMessagesMock).toHaveBeenCalledWith("room-1", {
      q: "hi",
      limit: 50,
    });

    // Supersede in-flight request with a newer query.
    rerender(<Probe roomId="room-1" open={true} debouncedQuery="hello" />);
    await waitFor(() =>
      expect(screen.getByTestId("results")).toHaveTextContent("m2"),
    );

    // Late resolution of first request must not overwrite newer results.
    await act(async () => {
      first.resolve({ data: [{ id: "m1" }] as ChatRoomMessage[] });
      await first.promise;
    });
    expect(screen.getByTestId("results")).toHaveTextContent("m2");

    // Failed search reports labels.error and clears hits.
    rerender(<Probe roomId="room-1" open={true} debouncedQuery="fail" />);
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(LABELS.error),
    );
    expect(screen.getByTestId("results")).toHaveTextContent("");

    unmount();
  });
});
