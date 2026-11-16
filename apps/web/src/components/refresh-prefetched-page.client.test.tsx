import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { RefreshPrefetchedPage } from "./refresh-prefetched-page.client";

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
    const container = document.createElement("div");
    container.innerHTML = renderToString(<RefreshPrefetchedPage />);
    document.body.appendChild(container);

    render(<RefreshPrefetchedPage />, { container, hydrate: true });

    expect(refresh).not.toHaveBeenCalled();
  });
});
