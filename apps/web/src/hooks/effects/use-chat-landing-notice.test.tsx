import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

import { useChatLandingNotice } from "./use-chat-landing-notice";

function NoticeProbe({
  notice,
  router,
  t,
}: {
  notice: string | null;
  router: { replace: (href: string, options?: { scroll?: boolean }) => void };
  t: (key: "roomUnavailable") => string;
}) {
  useChatLandingNotice(notice, router, t);
  return null;
}

describe("useChatLandingNotice", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("shows the room-unavailable toast and replaces the route only for room-unavailable, and re-runs on translator identity change", () => {
    const router = { replace: vi.fn() };
    const tFirst = vi.fn((key: "roomUnavailable") => `translated:${key}`);
    const tSecond = vi.fn((key: "roomUnavailable") => `translated:${key}`);

    const { rerender, unmount } = render(
      <NoticeProbe notice={null} router={router} t={tFirst} />,
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();

    rerender(<NoticeProbe notice="other" router={router} t={tFirst} />);
    expect(toastError).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();

    rerender(
      <NoticeProbe notice="room-unavailable" router={router} t={tFirst} />,
    );
    expect(toastError).toHaveBeenCalledExactlyOnceWith(
      "translated:roomUnavailable",
    );
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/", {
      scroll: false,
    });

    // A new translator identity returning the same string still re-triggers the effect.
    rerender(
      <NoticeProbe notice="room-unavailable" router={router} t={tSecond} />,
    );
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledTimes(2);
    expect(tSecond).toHaveBeenCalledExactlyOnceWith("roomUnavailable");

    unmount();
  });

  it("matches StrictMode replay and Activity hide/reveal calls", () => {
    const router = { replace: vi.fn() };
    const t = vi.fn((key: "roomUnavailable") => `translated:${key}`);

    const strict = render(
      <StrictMode>
        <NoticeProbe notice="room-unavailable" router={router} t={t} />
      </StrictMode>,
    );
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledTimes(2);
    strict.unmount();

    toastError.mockClear();
    router.replace.mockClear();

    const activity = render(
      <Activity mode="visible">
        <NoticeProbe notice="room-unavailable" router={router} t={t} />
      </Activity>,
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledTimes(1);

    activity.rerender(
      <Activity mode="hidden">
        <NoticeProbe notice="room-unavailable" router={router} t={t} />
      </Activity>,
    );
    expect(toastError).toHaveBeenCalledTimes(1);

    activity.rerender(
      <Activity mode="visible">
        <NoticeProbe notice="room-unavailable" router={router} t={t} />
      </Activity>,
    );
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledTimes(2);
    activity.unmount();
  });
});
