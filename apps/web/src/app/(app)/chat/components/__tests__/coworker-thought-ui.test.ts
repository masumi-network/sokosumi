import { describe, expect, it } from "vitest";

import { formatBeautifulElapsed } from "../coworker-thought-ui";

describe("formatBeautifulElapsed", () => {
  it("shows tenths only under 10 seconds", () => {
    expect(formatBeautifulElapsed(0)).toBe("0.0s");
    expect(formatBeautifulElapsed(5_600)).toBe("5.6s");
    expect(formatBeautifulElapsed(9_900)).toBe("9.9s");
  });

  it("shows whole seconds from 10s up", () => {
    expect(formatBeautifulElapsed(10_000)).toBe("10s");
    expect(formatBeautifulElapsed(10_400)).toBe("10s");
    expect(formatBeautifulElapsed(59_900)).toBe("59s");
  });

  it("formats a minute and above without tenths", () => {
    expect(formatBeautifulElapsed(60_000)).toBe("1m");
    expect(formatBeautifulElapsed(75_500)).toBe("1m 15s");
  });
});
