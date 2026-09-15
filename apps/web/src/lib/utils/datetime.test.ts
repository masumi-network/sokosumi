import { afterEach, describe, expect, it } from "vitest";

import { formatShortDate, formatShortDateTime } from "@/lib/utils/datetime";

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
  it("renders short date-times in the viewer's zone, not the server's", () => {
    // 14:50 UTC is 16:50 in Berlin during CEST.
    const timestamp = "2026-09-15T14:50:00.000Z";

    expect(formatShortDateTime(timestamp, "en", "Europe/Berlin")).toBe(
      "Sep 15, 4:50 PM",
    );
    expect(formatShortDateTime(timestamp, "en", "UTC")).toBe("Sep 15, 2:50 PM");
  });

  it("renders short dates in the viewer's zone across midnight", () => {
    const timestampNearMidnight = "2026-06-08T22:30:00.000Z";

    expect(formatShortDate(timestampNearMidnight, "en", "Europe/Berlin")).toBe(
      "Jun 9",
    );
    expect(formatShortDate(timestampNearMidnight, "en", "UTC")).toBe("Jun 8");
  });

  it("ignores the process time zone so server and browser agree", () => {
    const timestampNearMidnight = "2026-06-08T22:30:00.000Z";

    const serverDateTime = withTimeZone("UTC", () =>
      formatShortDateTime(timestampNearMidnight, "de-DE", "Europe/Berlin"),
    );
    const browserDateTime = withTimeZone("America/New_York", () =>
      formatShortDateTime(timestampNearMidnight, "de-DE", "Europe/Berlin"),
    );

    expect(browserDateTime).toBe(serverDateTime);
  });
});
