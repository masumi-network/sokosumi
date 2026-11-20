import { render, renderHook } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock, toastErrorMock, toastSuccessMock, useRouterSpy } =
  vi.hoisted(() => ({
    replaceMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    useRouterSpy: vi.fn(),
  }));

const stableRouter = {
  replace: replaceMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => {
    useRouterSpy();
    return stableRouter;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

import {
  type RouteNoticeToast,
  type StateToast,
  useRouteNoticeToast,
  useStateToast,
} from "./use-route-notice-toast";

describe("useRouteNoticeToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toasts and cleans the route when a notice appears, ignoring fresh equal objects", () => {
    const { rerender } = renderHook(
      ({ notice }: { notice: RouteNoticeToast | null }) =>
        useRouteNoticeToast(notice),
      { initialProps: { notice: null as RouteNoticeToast | null } },
    );

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();

    rerender({
      notice: {
        variant: "error",
        message: "Room unavailable",
        replaceHref: "/",
        replaceScroll: false,
      },
    });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenLastCalledWith("Room unavailable");
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenLastCalledWith("/", { scroll: false });

    // A fresh object literal with the same values does not re-fire.
    rerender({
      notice: {
        variant: "error",
        message: "Room unavailable",
        replaceHref: "/",
        replaceScroll: false,
      },
    });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);

    // Changing to a success notice without replaceScroll passes 1 arg to replace.
    rerender({
      notice: {
        key: "active",
        variant: "success",
        message: "Connected",
        replaceHref: "/personal-assistant",
      },
    });
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenLastCalledWith("Connected");
    expect(replaceMock).toHaveBeenCalledTimes(2);
    expect(replaceMock).toHaveBeenLastCalledWith("/personal-assistant");
  });

  it("re-fires when key changes even if message and replaceHref are unchanged", () => {
    const { rerender } = renderHook(
      ({ key }: { key: string }) =>
        useRouteNoticeToast({
          key,
          variant: "error",
          message: "Connect failed",
          replaceHref: "/personal-assistant",
        }),
      { initialProps: { key: "failed" } },
    );

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);

    rerender({ key: "expired" });
    expect(toastErrorMock).toHaveBeenCalledTimes(2);
    expect(replaceMock).toHaveBeenCalledTimes(2);
  });

  it("re-runs on React Activity reveal when once is false", () => {
    function Probe({ notice }: { notice: RouteNoticeToast | null }) {
      useRouteNoticeToast(notice);
      return null;
    }

    const notice: RouteNoticeToast = {
      variant: "error",
      message: "Room unavailable",
      replaceHref: "/",
      replaceScroll: false,
    };

    const { rerender } = render(
      <Activity mode="visible">
        <Probe notice={notice} />
      </Activity>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <Probe notice={notice} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe notice={notice} />
      </Activity>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(2);
    expect(replaceMock).toHaveBeenCalledTimes(2);
  });

  it("fires at most once when once is true across StrictMode and Activity reveal", () => {
    function Probe({ notice }: { notice: RouteNoticeToast | null }) {
      useRouteNoticeToast(notice);
      return null;
    }

    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe notice={null} />
        </Activity>
      </StrictMode>,
    );
    expect(toastErrorMock).not.toHaveBeenCalled();

    const firstNotice: RouteNoticeToast = {
      variant: "error",
      message: "Portal failed",
      replaceHref: "/billing",
      once: true,
    };
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe notice={firstNotice} />
        </Activity>
      </StrictMode>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe
            notice={{
              variant: "error",
              message: "Another error",
              replaceHref: "/billing?tab=1",
              once: true,
            }}
          />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe
            notice={{
              variant: "error",
              message: "Another error",
              replaceHref: "/billing?tab=1",
              once: true,
            }}
          />
        </Activity>
      </StrictMode>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });
});

describe("useStateToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a toast without calling useRouter, respects options, and re-fires on key change", () => {
    const { rerender } = renderHook(
      ({ notice }: { notice: StateToast | null }) => useStateToast(notice),
      { initialProps: { notice: null as StateToast | null } },
    );

    expect(useRouterSpy).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();

    rerender({
      notice: {
        key: "post-1",
        variant: "error",
        message: "Post not found",
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
      },
    });
    expect(useRouterSpy).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenLastCalledWith("Post not found", {
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
    });

    // Fresh equal object does not re-fire.
    rerender({
      notice: {
        key: "post-1",
        variant: "error",
        message: "Post not found",
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
      },
    });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);

    // Changing key re-fires.
    rerender({
      notice: {
        key: "post-2",
        variant: "error",
        message: "Post not found",
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
      },
    });
    expect(toastErrorMock).toHaveBeenCalledTimes(2);

    // Plain success toast passes 1 arg when no options are set.
    rerender({
      notice: {
        variant: "success",
        message: "Saved",
      },
    });
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenLastCalledWith("Saved");
  });

  it("re-runs on React Activity reveal while notice is active", () => {
    function Probe({ notice }: { notice: StateToast | null }) {
      useStateToast(notice);
      return null;
    }

    const notice: StateToast = {
      key: "post-1",
      variant: "error",
      message: "Post not found",
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
    };

    const { rerender } = render(
      <Activity mode="visible">
        <Probe notice={notice} />
      </Activity>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <Probe notice={notice} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe notice={notice} />
      </Activity>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(2);
  });
});
