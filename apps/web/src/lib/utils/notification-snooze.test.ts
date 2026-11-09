import { describe, expect, it } from "vitest";

import { snoozeUntil } from "./notification-snooze";

// Local time, like the reader's browser: Wednesday 12 November 2025, 22:30.
const WEDNESDAY_NIGHT = new Date(2025, 10, 12, 22, 30);

describe("snoozeUntil", () => {
  it("comes back an hour later", () => {
    expect(snoozeUntil("hour", WEDNESDAY_NIGHT)).toEqual(
      new Date(2025, 10, 12, 23, 30),
    );
  });

  it("comes back tomorrow at 9:00", () => {
    expect(snoozeUntil("tomorrow", WEDNESDAY_NIGHT)).toEqual(
      new Date(2025, 10, 13, 9, 0),
    );
  });

  it("comes back next Monday at 9:00", () => {
    expect(snoozeUntil("nextWeek", WEDNESDAY_NIGHT)).toEqual(
      new Date(2025, 10, 17, 9, 0),
    );
  });

  it("goes a whole week ahead on a Monday", () => {
    expect(snoozeUntil("nextWeek", new Date(2025, 10, 17, 8, 0))).toEqual(
      new Date(2025, 10, 24, 9, 0),
    );
  });

  it("reaches Monday from Sunday", () => {
    expect(snoozeUntil("nextWeek", new Date(2025, 10, 16, 20, 0))).toEqual(
      new Date(2025, 10, 17, 9, 0),
    );
  });
});
