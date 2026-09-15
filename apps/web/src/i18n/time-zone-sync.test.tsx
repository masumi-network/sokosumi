import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TIME_ZONE_COOKIE_NAME } from "@/i18n/time-zone";

const refresh = vi.hoisted(() => vi.fn());
const useTimeZone = vi.hoisted(() => vi.fn(() => "UTC"));
const getDefaultTimezone = vi.hoisted(() => vi.fn(() => "Europe/Berlin"));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => useTimeZone(),
}));

vi.mock("@/lib/schedules/timezones", () => ({
  getDefaultTimezone: () => getDefaultTimezone(),
}));

import { TimeZoneSync } from "@/i18n/time-zone-sync";

function clearTimeZoneCookie() {
  document.cookie = `${TIME_ZONE_COOKIE_NAME}=; path=/; max-age=0`;
}

describe("TimeZoneSync", () => {
  beforeEach(() => {
    refresh.mockClear();
    useTimeZone.mockReturnValue("UTC");
    getDefaultTimezone.mockReturnValue("Europe/Berlin");
    clearTimeZoneCookie();
  });

  afterEach(() => {
    clearTimeZoneCookie();
  });

  it("writes the browser zone and refreshes once when the render zone differs", async () => {
    render(<TimeZoneSync />);

    await waitFor(() => {
      expect(document.cookie).toContain(`${TIME_ZONE_COOKIE_NAME}=`);
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("does not refresh when the cookie write does not stick", async () => {
    const cookieDesc =
      Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ??
      Object.getOwnPropertyDescriptor(document, "cookie");
    const setter = vi.fn();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: setter,
    });

    try {
      render(<TimeZoneSync />);

      await waitFor(() => {
        expect(setter).toHaveBeenCalled();
      });
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      if (cookieDesc) {
        Object.defineProperty(document, "cookie", cookieDesc);
      }
    }
  });

  it("does not refresh when the browser zone already matches", async () => {
    useTimeZone.mockReturnValue("Europe/Berlin");
    render(<TimeZoneSync />);

    await waitFor(() => {
      expect(getDefaultTimezone).toHaveBeenCalled();
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain(`${TIME_ZONE_COOKIE_NAME}=`);
  });
});
