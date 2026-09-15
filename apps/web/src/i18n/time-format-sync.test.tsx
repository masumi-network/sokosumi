import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DETECTED_TIME_FORMAT_COOKIE_NAME,
  TIME_FORMAT_COOKIE_NAME,
} from "@/i18n/time-format";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { TimeFormatSync } from "@/i18n/time-format-sync";

/** The browser's own convention, which is what Auto reads. */
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

describe("TimeFormatSync", () => {
  beforeEach(() => {
    refresh.mockClear();
    stubBrowserHourCycle("h23");
    clearTimeFormatCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTimeFormatCookies();
  });

  it("records the browser's format and refreshes once when none is stored", async () => {
    render(<TimeFormatSync />);

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${DETECTED_TIME_FORMAT_COOKIE_NAME}=24h`,
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("rewrites a stale value after the browser's convention changed", async () => {
    document.cookie = `${DETECTED_TIME_FORMAT_COOKIE_NAME}=12h; path=/`;

    render(<TimeFormatSync />);

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${DETECTED_TIME_FORMAT_COOKIE_NAME}=24h`,
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("records the browser's format without refreshing when an explicit choice outranks Auto", async () => {
    document.cookie = `${TIME_FORMAT_COOKIE_NAME}=12h; path=/`;

    render(<TimeFormatSync />);

    await waitFor(() => {
      expect(document.cookie).toContain(
        `${DETECTED_TIME_FORMAT_COOKIE_NAME}=24h`,
      );
    });
    expect(refresh).not.toHaveBeenCalled();
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
      render(<TimeFormatSync />);

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

  it("does nothing when the server already rendered with the browser's format", async () => {
    document.cookie = `${DETECTED_TIME_FORMAT_COOKIE_NAME}=24h; path=/`;

    render(<TimeFormatSync />);

    await waitFor(() => {
      expect(Intl.DateTimeFormat.prototype.resolvedOptions).toHaveBeenCalled();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
