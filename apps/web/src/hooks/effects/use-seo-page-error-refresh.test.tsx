import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { useSeoPageErrorRefresh } from "./use-seo-page-error-refresh";

function RefreshProbe({ askPage }: { askPage: boolean }) {
  useSeoPageErrorRefresh(askPage);
  return null;
}

describe("useSeoPageErrorRefresh", () => {
  beforeEach(() => {
    routerMock.refresh.mockClear();
  });

  it("refreshes the router when askPage is true or becomes true", () => {
    const { rerender, unmount } = render(<RefreshProbe askPage={false} />);
    expect(routerMock.refresh).not.toHaveBeenCalled();

    rerender(<RefreshProbe askPage={true} />);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);

    rerender(<RefreshProbe askPage={true} />);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("matches StrictMode replay refresh calls", () => {
    const { unmount } = render(
      <StrictMode>
        <RefreshProbe askPage={true} />
      </StrictMode>,
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("refreshes again on React Activity reveal when askPage is true", () => {
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <RefreshProbe askPage={true} />
      </Activity>,
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <RefreshProbe askPage={true} />
      </Activity>,
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <RefreshProbe askPage={true} />
      </Activity>,
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(2);

    unmount();
  });
});
