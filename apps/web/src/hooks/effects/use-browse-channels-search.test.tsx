import type { DiscoverableChatRoom } from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDiscoverableChannelsAction: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/app/chat/actions", () => ({
  listDiscoverableChannelsAction: mocks.listDiscoverableChannelsAction,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

import { useBrowseChannelsSearch } from "./use-browse-channels-search";

const ROOM = { id: "room-1", name: "General" } as DiscoverableChatRoom;

const defaultT = (key: "loadError") =>
  key === "loadError" ? "Failed to load" : key;

function BrowseProbe({
  open,
  query,
  t = defaultT,
}: {
  open: boolean;
  query: string;
  t?: (key: "loadError") => string;
}) {
  const { rooms, isLoading } = useBrowseChannelsSearch(open, query, t);
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="rooms">{rooms.map((r) => r.name).join(",")}</span>
    </div>
  );
}

describe("useBrowseChannelsSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listDiscoverableChannelsAction.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces discoverable channel reads while open and toasts on failure", async () => {
    mocks.listDiscoverableChannelsAction
      .mockResolvedValueOnce({ ok: true, value: [ROOM] })
      .mockResolvedValueOnce({ ok: false, error: { message: "boom" } });

    const { rerender, unmount } = render(<BrowseProbe open={false} query="" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mocks.listDiscoverableChannelsAction).not.toHaveBeenCalled();

    rerender(<BrowseProbe open={true} query="gen" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.listDiscoverableChannelsAction).toHaveBeenCalledWith({
      q: "gen",
    });
    expect(screen.getByTestId("rooms")).toHaveTextContent("General");

    rerender(<BrowseProbe open={true} query="err" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith("boom");
    expect(screen.getByTestId("rooms")).toHaveTextContent("");

    unmount();
  });

  it("cancels debounce on StrictMode replay and Activity hide, and ignores late results after unmount", async () => {
    const pending = Promise.withResolvers<{
      ok: false;
      error: { message: string };
    }>();
    mocks.listDiscoverableChannelsAction.mockReturnValueOnce(pending.promise);

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <BrowseProbe open={true} query="abc" />
        </Activity>
      </StrictMode>,
    );

    // Hide before debounce fires: cancels timer so action does not run.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <BrowseProbe open={true} query="abc" />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mocks.listDiscoverableChannelsAction).not.toHaveBeenCalled();

    // Reveal, let debounce fire once, then unmount while request is pending.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <BrowseProbe open={true} query="abc" />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.listDiscoverableChannelsAction).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      pending.resolve({ ok: false, error: { message: "late error" } });
      await pending.promise;
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
