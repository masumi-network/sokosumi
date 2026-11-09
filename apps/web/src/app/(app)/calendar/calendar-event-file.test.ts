import { describe, expect, it } from "vitest";
import {
  calendarEventFile,
  calendarEventFileName,
} from "./calendar-event-file";

const base = {
  uid: "run-1@app.sokosumi.com",
  title: "Weekly report",
  start: new Date("2026-11-12T09:30:00.000Z"),
  url: "https://app.sokosumi.com/tasks/task-1",
  now: new Date("2026-11-09T12:00:05.123Z"),
};

describe("calendarEventFile", () => {
  it("writes one event at the start time in UTC with CRLF lines", () => {
    const file = calendarEventFile(base);

    expect(file.split("\r\n")).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Sokosumi//Calendar//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:run-1@app.sokosumi.com",
      "DTSTAMP:20261109T120005Z",
      "DTSTART:20261112T093000Z",
      "SUMMARY:Weekly report",
      "DESCRIPTION:https://app.sokosumi.com/tasks/task-1",
      "URL:https://app.sokosumi.com/tasks/task-1",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
    // A snapshot, not a scheduling message: PUBLISH would need an ORGANIZER
    // and a matching MIME method (RFC 5546 3.2.1, RFC 5545 8.1).
    expect(file).not.toMatch(/METHOD|DTEND|DURATION/);
  });

  it("escapes text that would break the format", () => {
    const file = calendarEventFile({
      ...base,
      title: "Plan; budget, review\\notes\nnext",
    });

    expect(file).toContain(
      "SUMMARY:Plan\\; budget\\, review\\\\notes\\nnext\r\n",
    );
  });

  it("turns every newline form into an escaped newline", () => {
    const file = calendarEventFile({ ...base, title: "a\r\nb\rc\nd" });

    expect(file).toContain("SUMMARY:a\\nb\\nc\\nd\r\n");
  });

  it("leaves no bare CR, LF or other control character inside a line", () => {
    const file = calendarEventFile({
      ...base,
      title: "Before\rAfter\u0000\u0007\u001b\u007f\tend",
    });
    const lines = file.split("\r\n");

    expect(lines).toContain("SUMMARY:Before\\nAfter\tend");
    for (const line of lines) {
      expect(line).not.toMatch(/[\u0000-\u0008\u000A-\u001F\u007F]/);
    }
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const file = calendarEventFile({ ...base, title: "ü".repeat(80) });
    const lines = file.split("\r\n");
    const summary = lines.findIndex((line) => line.startsWith("SUMMARY:"));
    const encoder = new TextEncoder();

    expect(lines[summary + 1].startsWith(" ")).toBe(true);
    for (const line of lines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    const unfolded = file.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${"ü".repeat(80)}\r\n`);
  });
});

describe("calendarEventFileName", () => {
  it("makes a short file name from the title", () => {
    expect(calendarEventFileName("Weekly report: Q4 / EU")).toBe(
      "weekly-report-q4-eu.ics",
    );
  });

  it("falls back when nothing usable is left", () => {
    expect(calendarEventFileName("🚀✨")).toBe("event.ics");
  });
});
