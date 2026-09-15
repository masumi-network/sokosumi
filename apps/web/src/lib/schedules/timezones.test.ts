import { isValidTimezone } from "@sokosumi/utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDefaultTimezone } from "./timezones";

describe("getDefaultTimezone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid IANA zone", () => {
    expect(isValidTimezone(getDefaultTimezone())).toBe(true);
  });

  it("falls back to UTC when the resolved zone is not a valid IANA id", () => {
    const real = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...real,
      timeZone: "Factory",
    });

    expect(getDefaultTimezone()).toBe("UTC");
  });
});
