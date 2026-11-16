import { act, render } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { RefreshPrefetchedPage } from "./refresh-prefetched-page.client";

function hydrate(ui: React.ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(ui);
  document.body.appendChild(container);
  return render(ui, { container, hydrate: true });
}

describe("RefreshPrefetchedPage", () => {
  beforeEach(() => {
    refresh.mockReset();
  });

  it("refreshes once when a client navigation mounts it", () => {
    const { rerender } = render(<RefreshPrefetchedPage />);
    rerender(<RefreshPrefetchedPage />);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a page the document load just rendered", () => {
    hydrate(<RefreshPrefetchedPage />);

    expect(refresh).not.toHaveBeenCalled();
  });

  // Next keeps a left page in a hidden <Activity> and shows it again with its
  // state, so the hydration flag must not outlive the first visit.
  it("refreshes when a hydrated page is shown again after a navigation", () => {
    const { rerender } = hydrate(
      <Activity mode="visible">
        <RefreshPrefetchedPage />
      </Activity>,
    );

    act(() => {
      rerender(
        <Activity mode="hidden">
          <RefreshPrefetchedPage />
        </Activity>,
      );
    });
    act(() => {
      rerender(
        <Activity mode="visible">
          <RefreshPrefetchedPage />
        </Activity>,
      );
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
