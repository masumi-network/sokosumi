import { afterEach, describe, expect, it } from "vitest";

import { formatShortDate } from "@/lib/utils/datetime";

const originalTimeZone = process.env.TZ;

function restoreTimeZone() {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
    return;
  }

  process.env.TZ = originalTimeZone;
}

function withTimeZone<T>(timeZone: string, callback: () => T): T {
  process.env.TZ = timeZone;
  return callback();
}

afterEach(() => {
  restoreTimeZone();
});

describe("datetime formatting", () => {
  it("renders short dates in the viewer's zone across midnight", () => {
    const timestampNearMidnight = "2026-06-08T22:30:00.000Z";

    expect(formatShortDate(timestampNearMidnight, "en", "Europe/Berlin")).toBe(
      "Jun 9",
    );
    expect(formatShortDate(timestampNearMidnight, "en", "UTC")).toBe("Jun 8");
  });

  it("ignores the process time zone so server and browser agree", () => {
    const timestampNearMidnight = "2026-06-08T22:30:00.000Z";

    const serverDate = withTimeZone("UTC", () =>
      formatShortDate(timestampNearMidnight, "de-DE", "Europe/Berlin"),
    );
    const browserDate = withTimeZone("America/New_York", () =>
      formatShortDate(timestampNearMidnight, "de-DE", "Europe/Berlin"),
    );

    expect(browserDate).toBe(serverDate);
  });
});
