import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  toastError: vi.fn(),
  t: vi.fn((key: string) => `translated:${key}`),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => mocks.t,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

import { useChatLandingNotice } from "./use-chat-landing-notice";

function NoticeProbe({ notice }: { notice: string | null }) {
  useChatLandingNotice(notice);
  return null;
}

describe("useChatLandingNotice", () => {
  beforeEach(() => {
    mocks.router.replace.mockClear();
    mocks.toastError.mockClear();
    mocks.t.mockClear();
  });

  it("shows the room-unavailable toast and replaces the route only for room-unavailable", () => {
    const { rerender, unmount } = render(<NoticeProbe notice={null} />);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();

    rerender(<NoticeProbe notice="other" />);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();

    rerender(<NoticeProbe notice="room-unavailable" />);
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      "translated:roomUnavailable",
    );
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/", {
      scroll: false,
    });

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal calls", () => {
    const strict = render(
      <StrictMode>
        <NoticeProbe notice="room-unavailable" />
      </StrictMode>,
    );
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
    expect(mocks.router.replace).toHaveBeenCalledTimes(2);
    strict.unmount();

    mocks.toastError.mockClear();
    mocks.router.replace.mockClear();

    const activity = render(
      <Activity mode="visible">
        <NoticeProbe notice="room-unavailable" />
      </Activity>,
    );
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);

    activity.rerender(
      <Activity mode="hidden">
        <NoticeProbe notice="room-unavailable" />
      </Activity>,
    );
    expect(mocks.toastError).toHaveBeenCalledTimes(1);

    activity.rerender(
      <Activity mode="visible">
        <NoticeProbe notice="room-unavailable" />
      </Activity>,
    );
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
    expect(mocks.router.replace).toHaveBeenCalledTimes(2);
    activity.unmount();
  });
});
