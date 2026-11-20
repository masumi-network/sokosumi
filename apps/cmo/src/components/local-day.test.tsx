import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LocalStamp } from "./local-day";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T17:45:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("writes today's message as a time, in UTC on the server", () => {
  expect(renderToString(<LocalStamp at="2026-11-18T10:17:00Z" />)).toBe(
    '<time dateTime="2026-11-18T10:17:00Z">10:17</time>',
  );
});

it("adds the day to an older message", () => {
  expect(renderToString(<LocalStamp at="2026-11-17T23:07:00Z" />)).toContain(
    "Tue 17 Nov, 23:07",
  );
});
