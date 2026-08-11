import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoomMessagesHydrator } from "../room-messages-hydrator";

describe("RoomMessagesHydrator", () => {
  it("reports the resolved page once when the promise settles", async () => {
    let resolvePage!: (page: {
      messages: [];
      nextCursor: null;
      failed: boolean;
    }) => void;
    const promise = new Promise<{
      messages: [];
      nextCursor: null;
      failed: boolean;
    }>((resolve) => {
      resolvePage = resolve;
    });
    const onResolved = vi.fn();

    render(<RoomMessagesHydrator promise={promise} onResolved={onResolved} />);

    expect(onResolved).not.toHaveBeenCalled();

    await act(async () => {
      resolvePage({ messages: [], nextCursor: null, failed: false });
      await promise;
    });

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
    expect(onResolved).toHaveBeenCalledWith({
      messages: [],
      nextCursor: null,
      failed: false,
    });
  });
});
