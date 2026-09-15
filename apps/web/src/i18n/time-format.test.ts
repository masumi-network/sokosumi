import { describe, expect, it } from "vitest";

import { resolveRequestHourCycle } from "@/i18n/time-format";

describe("resolveRequestHourCycle", () => {
  it("lets an explicit preference beat what Auto detected", () => {
    expect(
      resolveRequestHourCycle({ preference: "24h", detected: "12h" }),
    ).toBe("h23");
    expect(
      resolveRequestHourCycle({ preference: "12h", detected: "24h" }),
    ).toBe("h12");
  });

  it("uses the detected value when there is no explicit preference", () => {
    expect(
      resolveRequestHourCycle({ preference: undefined, detected: "24h" }),
    ).toBe("h23");
    expect(
      resolveRequestHourCycle({ preference: undefined, detected: "12h" }),
    ).toBe("h12");
  });

  it("falls through a bogus preference to the detected value", () => {
    expect(
      resolveRequestHourCycle({ preference: "25h", detected: "24h" }),
    ).toBe("h23");
  });

  it("leaves the language default when both cookies are missing or bogus", () => {
    expect(
      resolveRequestHourCycle({ preference: undefined, detected: undefined }),
    ).toBeUndefined();
    expect(
      resolveRequestHourCycle({ preference: "", detected: "" }),
    ).toBeUndefined();
    expect(
      resolveRequestHourCycle({ preference: "h23", detected: "auto" }),
    ).toBeUndefined();
  });
});
