import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TIME_ZONE_COOKIE_NAME } from "@/i18n/time-zone";

const refresh = vi.hoisted(() => vi.fn());
const getDefaultTimezone = vi.hoisted(() => vi.fn(() => "Europe/Berlin"));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/schedules/timezones", () => ({
  getDefaultTimezone: () => getDefaultTimezone(),
}));

import { useBrowserTimeZoneSync } from "./use-browser-time-zone-sync";

function clearTimeZoneCookie() {
  document.cookie = `${TIME_ZONE_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

describe("useBrowserTimeZoneSync", () => {
  beforeEach(() => {
    refresh.mockClear();
    getDefaultTimezone.mockReturnValue("Europe/Berlin");
    clearTimeZoneCookie();
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "cookie");
    clearTimeZoneCookie();
  });

  it("writes the browser time zone cookie and refreshes when renderedTimeZone differs or is undefined", async () => {
    renderHook(() => useBrowserTimeZoneSync(undefined));

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${TIME_ZONE_COOKIE_NAME}=Europe%2FBerlin`,
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("re-runs when renderedTimeZone changes to a mismatched value", async () => {
    const { rerender } = renderHook(
      ({ renderedTimeZone }) => useBrowserTimeZoneSync(renderedTimeZone),
      { initialProps: { renderedTimeZone: "Europe/Berlin" } },
    );

    expect(refresh).not.toHaveBeenCalled();

    rerender({ renderedTimeZone: "America/New_York" });

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${TIME_ZONE_COOKIE_NAME}=Europe%2FBerlin`,
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("updates a stale cookie and refreshes once when the write sticks", async () => {
    document.cookie = `${TIME_ZONE_COOKIE_NAME}=America%2FNew_York; path=/`;

    renderHook(() => useBrowserTimeZoneSync("America/New_York"));

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${TIME_ZONE_COOKIE_NAME}=Europe%2FBerlin`,
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("does not refresh when the stored cookie already matches the detected zone", () => {
    document.cookie = `${TIME_ZONE_COOKIE_NAME}=Europe%2FBerlin; path=/`;

    renderHook(() => useBrowserTimeZoneSync("UTC"));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips refresh when the cookie write does not stick or leaves a stale zone behind", async () => {
    const setter = vi.fn();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => `${TIME_ZONE_COOKIE_NAME}=America%2FNew_York`,
      set: setter,
    });

    renderHook(() => useBrowserTimeZoneSync("UTC"));

    await waitFor(() => {
      expect(setter).toHaveBeenCalled();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
