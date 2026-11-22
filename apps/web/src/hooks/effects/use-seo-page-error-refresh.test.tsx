import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSeoPageErrorRefresh } from "./use-seo-page-error-refresh";

function RefreshProbe({
  askPage,
  router,
}: {
  askPage: boolean;
  router: { refresh: () => void };
}) {
  useSeoPageErrorRefresh(askPage, router);
  return null;
}

describe("useSeoPageErrorRefresh", () => {
  it("refreshes the router when askPage becomes true or the router instance changes", () => {
    const router = { refresh: vi.fn() };
    const { rerender, unmount } = render(
      <RefreshProbe askPage={false} router={router} />,
    );
    expect(router.refresh).not.toHaveBeenCalled();

    rerender(<RefreshProbe askPage={true} router={router} />);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    rerender(<RefreshProbe askPage={true} router={router} />);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    const nextRouter = { refresh: vi.fn() };
    rerender(<RefreshProbe askPage={true} router={nextRouter} />);
    expect(nextRouter.refresh).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("matches StrictMode replay refresh calls", () => {
    const router = { refresh: vi.fn() };
    const { unmount } = render(
      <StrictMode>
        <RefreshProbe askPage={true} router={router} />
      </StrictMode>,
    );
    expect(router.refresh).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("refreshes again on React Activity reveal when askPage is true", () => {
    const router = { refresh: vi.fn() };
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <RefreshProbe askPage={true} router={router} />
      </Activity>,
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <RefreshProbe askPage={true} router={router} />
      </Activity>,
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <RefreshProbe askPage={true} router={router} />
      </Activity>,
    );
    expect(router.refresh).toHaveBeenCalledTimes(2);

    unmount();
  });
});
