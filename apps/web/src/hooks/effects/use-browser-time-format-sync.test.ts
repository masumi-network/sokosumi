import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DETECTED_TIME_FORMAT_COOKIE_NAME,
  TIME_FORMAT_COOKIE_NAME,
} from "@/i18n/time-format";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { useBrowserTimeFormatSync } from "./use-browser-time-format-sync";

function stubBrowserHourCycle(
  hourCycle: Intl.ResolvedDateTimeFormatOptions["hourCycle"],
) {
  const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), hourCycle };
    },
  );
}

function clearTimeFormatCookies() {
  document.cookie = `${DETECTED_TIME_FORMAT_COOKIE_NAME}=; path=/; max-age=0`;
  document.cookie = `${TIME_FORMAT_COOKIE_NAME}=; path=/; max-age=0`;
}

describe("useBrowserTimeFormatSync", () => {
  beforeEach(() => {
    refresh.mockClear();
    stubBrowserHourCycle("h23");
    clearTimeFormatCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTimeFormatCookies();
  });

  it("writes the detected format cookie and refreshes once under Auto", async () => {
    renderHook(() => useBrowserTimeFormatSync());

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${DETECTED_TIME_FORMAT_COOKIE_NAME}=24h`,
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("writes the cookie without refreshing when an explicit preference is set", async () => {
    document.cookie = `${TIME_FORMAT_COOKIE_NAME}=12h; path=/`;

    renderHook(() => useBrowserTimeFormatSync());

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${DETECTED_TIME_FORMAT_COOKIE_NAME}=24h`,
      );
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips refresh when the cookie write does not stick", async () => {
    const setter = vi.fn();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: setter,
    });

    try {
      renderHook(() => useBrowserTimeFormatSync());

      await waitFor(() => {
        expect(setter).toHaveBeenCalled();
      });
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "cookie");
    }
  });

  it("does nothing when the detected cookie already matches", async () => {
    document.cookie = `${DETECTED_TIME_FORMAT_COOKIE_NAME}=24h; path=/`;

    renderHook(() => useBrowserTimeFormatSync());

    await waitFor(() => {
      expect(Intl.DateTimeFormat.prototype.resolvedOptions).toHaveBeenCalled();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
