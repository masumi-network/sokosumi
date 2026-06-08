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
  it("keeps short task dates stable across server and browser time zones", () => {
    const timestampNearMidnight = "2026-06-08T22:30:00.000Z";

    const serverDate = withTimeZone("UTC", () =>
      formatShortDate(timestampNearMidnight, "de-DE"),
    );
    const browserDate = withTimeZone("Europe/Berlin", () =>
      formatShortDate(timestampNearMidnight, "de-DE"),
    );

    expect(browserDate).toBe(serverDate);
  });

  it("keeps short date-times stable across server and browser time zones", () => {
    const timestampNearMidnight = "2026-06-08T22:30:00.000Z";

    const serverDateTime = withTimeZone("UTC", () =>
      formatShortDateTime(timestampNearMidnight, "de-DE"),
    );
    const browserDateTime = withTimeZone("Europe/Berlin", () =>
      formatShortDateTime(timestampNearMidnight, "de-DE"),
    );

    expect(browserDateTime).toBe(serverDateTime);
  });
});
