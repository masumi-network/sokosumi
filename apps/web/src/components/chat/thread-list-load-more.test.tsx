import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLoadWhenVisible } from "@/hooks/use-load-when-visible";

import {
  ThreadListLoadMore,
  type ThreadListLoadMoreStatus,
} from "./thread-list-load-more";

vi.mock("@/hooks/use-load-when-visible", () => ({
  useLoadWhenVisible: vi.fn(),
}));

const labels = {
  load: "Load older threads",
  loading: "Loading threads…",
  error: "Could not load threads.",
  retry: "Try again",
};

function renderBoundary(status: ThreadListLoadMoreStatus, onLoad = vi.fn()) {
  render(
    <ThreadListLoadMore
      boundaryKey="last-thread"
      status={status}
      onLoad={onLoad}
      labels={labels}
    />,
  );
  return onLoad;
}

beforeEach(() => {
  vi.mocked(useLoadWhenVisible).mockClear();
});

describe("ThreadListLoadMore", () => {
  it("loads on its own when it scrolls into view, from where the list ends", () => {
    const onLoad = renderBoundary("idle");

    const [, options] = vi.mocked(useLoadWhenVisible).mock.calls[0] ?? [];
    expect(options).toMatchObject({ armed: true, boundaryKey: "last-thread" });
    options?.onVisible();
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("stays a button to press where nothing watches it", async () => {
    const onLoad = renderBoundary("idle");

    await userEvent.click(
      screen.getByRole("button", { name: "Load older threads" }),
    );
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("stops loading on its own after a failure and offers a retry", () => {
    renderBoundary("failed");

    const [, options] = vi.mocked(useLoadWhenVisible).mock.calls[0] ?? [];
    expect(options?.armed).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(labels.error);
    expect(screen.getByRole("button")).toHaveTextContent(labels.retry);
  });

  it("says it is loading only while it is", () => {
    renderBoundary("loading");

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveTextContent(labels.loading);
  });
});
