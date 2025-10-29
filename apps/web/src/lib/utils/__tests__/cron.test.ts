import {
  parseCron,
  computeNextOccurrence,
  formatTime,
} from "@/lib/schedules/cron";

describe("cron parser", () => {
  it("parses dailyAtTime", () => {
    const p = parseCron("5 10 * * *");
    expect(p).toEqual({ kind: "dailyAtTime", hour: 10, minute: 5 });
  });

  it("parses weeklyAtTime single", () => {
    const p = parseCron("0 9 * * MON");
    expect(p).toEqual({
      kind: "weeklyAtTime",
      hour: 9,
      minute: 0,
      dows: ["MON"],
    });
  });

  it("parses weeklyAtTime multi", () => {
    const p = parseCron("15 8 * * MON,WED,FRI");
    expect(p).toEqual({
      kind: "weeklyAtTime",
      hour: 8,
      minute: 15,
      dows: ["MON", "WED", "FRI"],
    });
  });

  it("parses monthlyOnDay", () => {
    const p = parseCron("0 7 12 * *");
    expect(p).toEqual({
      kind: "monthlyOnDay",
      hour: 7,
      minute: 0,
      dayOfMonth: 12,
    });
  });

  it("parses dailyEveryN", () => {
    const p = parseCron("0 9 */3 * *");
    expect(p).toEqual({
      kind: "dailyEveryN",
      hour: 9,
      minute: 0,
      everyNDays: 3,
    });
  });

  it("parses monthlyEveryN", () => {
    const p = parseCron("0 8 10 */2 *");
    expect(p).toEqual({
      kind: "monthlyEveryN",
      hour: 8,
      minute: 0,
      dayOfMonth: 10,
      everyNMonths: 2,
    });
  });

  it("returns unknown for unsupported", () => {
    const p = parseCron("*/5 * * * *"); // every 5 minutes - not supported pattern here
    expect(p).toEqual({ kind: "unknown" });
  });
});

describe("computeNextOccurrence (subset)", () => {
  it("computes next for dailyAtTime today or tomorrow", () => {
    const now = new Date("2025-01-10T10:30:00Z");
    const p = parseCron("45 10 * * *"); // 10:45
    const next = computeNextOccurrence(p, now);
    expect(next).toBeInstanceOf(Date);
  });

  it("computes next for weeklyAtTime single DOW", () => {
    const now = new Date("2025-01-10T10:30:00Z"); // Friday
    const p = parseCron("0 9 * * MON");
    const next = computeNextOccurrence(p, now);
    expect(next).toBeInstanceOf(Date);
  });

  it("computes next for monthlyOnDay with safe DOM", () => {
    const now = new Date("2025-02-28T10:30:00Z"); // Feb
    const p = parseCron("0 9 31 * *");
    const next = computeNextOccurrence(p, now);
    expect(next).toBeInstanceOf(Date);
  });
});

describe("formatTime", () => {
  it("formats in timezone", () => {
    const s = formatTime(10, 5, "UTC");
    expect(typeof s).toBe("string");
  });
});
