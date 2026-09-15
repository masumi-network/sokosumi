import { describe, expect, it } from "vitest";

import {
  resolveRequestTimeZone,
  serializeTimeZoneCookie,
} from "@/i18n/time-zone";

describe("resolveRequestTimeZone", () => {
  it("uses a valid IANA zone from the cookie", () => {
    expect(resolveRequestTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("falls back to UTC when the cookie is missing or bogus", () => {
    expect(resolveRequestTimeZone(undefined)).toBe("UTC");
    expect(resolveRequestTimeZone("")).toBe("UTC");
    expect(resolveRequestTimeZone("Mars/Olympus")).toBe("UTC");
    expect(resolveRequestTimeZone("Factory")).toBe("UTC");
  });
});

describe("serializeTimeZoneCookie", () => {
  it("writes the zone under the app cookie name", () => {
    expect(serializeTimeZoneCookie("Europe/Berlin")).toMatch(
      /^sokosumi\.timezone=Europe%2FBerlin; path=\/; max-age=\d+; SameSite=Lax$/,
    );
  });
});
