import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useUrlTimezone } from "./use-url-timezone";

function writeFor(
  urlTimezone: string | null,
  timeZone: string,
  rendered: string | undefined,
) {
  const write = vi.fn();
  renderHook(() => useUrlTimezone(urlTimezone, timeZone, rendered, write));
  return write;
}

describe("useUrlTimezone", () => {
  it("writes the zone without a second render when the server rendered in it", () => {
    expect(writeFor(null, "Europe/Oslo", "Europe/Oslo")).toHaveBeenCalledWith(
      { timezone: "Europe/Oslo" },
      { shallow: true },
    );
  });

  it("asks the server again when it rendered in another zone", () => {
    expect(writeFor(null, "Europe/Oslo", "UTC")).toHaveBeenCalledWith(
      { timezone: "Europe/Oslo" },
      { shallow: false },
    );
  });

  it("asks the server again when the zone it rendered in is unknown", () => {
    expect(writeFor(null, "Europe/Oslo", undefined)).toHaveBeenCalledWith(
      { timezone: "Europe/Oslo" },
      { shallow: false },
    );
  });

  it("replaces a zone in the URL that is not one", () => {
    expect(
      writeFor("garbage", "Europe/Oslo", "Europe/Oslo"),
    ).toHaveBeenCalledWith({ timezone: "Europe/Oslo" }, { shallow: true });
  });

  it("leaves a URL that names a zone alone", () => {
    expect(
      writeFor("Asia/Tokyo", "Asia/Tokyo", "Europe/Oslo"),
    ).not.toHaveBeenCalled();
  });
});
