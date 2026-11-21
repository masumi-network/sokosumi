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
      expect(document.cookie).toContain(`${TIME_ZONE_COOKIE_NAME}=`);
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
      expect(document.cookie).toContain(`${TIME_ZONE_COOKIE_NAME}=`);
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("refreshes when the cookie is already present and the rendered zone still differs", async () => {
    document.cookie = `${TIME_ZONE_COOKIE_NAME}=Europe%2FBerlin; path=/`;

    renderHook(() => useBrowserTimeZoneSync("UTC"));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("skips refresh when the cookie write does not stick", async () => {
    const setter = vi.fn();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: setter,
    });

    renderHook(() => useBrowserTimeZoneSync("UTC"));

    await waitFor(() => {
      expect(setter).toHaveBeenCalled();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
