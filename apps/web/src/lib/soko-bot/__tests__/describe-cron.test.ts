import { describe, expect, it } from "vitest";

import { describeCron } from "../describe-cron";

describe("describeCron", () => {
  it("names the shapes the assistant creates", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(describeCron("0 10 * * 1")).toBe("Every Monday at 10:00");
    expect(describeCron("30 8 * * *")).toBe("Every day at 08:30");
    expect(describeCron("0 * * * *")).toBe("Every hour");
    expect(describeCron("0 9 * * 1,3,5")).toBe("Mon, Wed, Fri at 09:00");
  });

  it("falls back to the expression for anything else", () => {
    expect(describeCron("0 9 1 * *")).toBe("0 9 1 * *");
    expect(describeCron("nonsense")).toBe("nonsense");
  });
});
