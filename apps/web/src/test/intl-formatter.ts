import { vi } from "vitest";

import { createFormats, type HourCycle } from "@/i18n/time-format";

// The actual module, so a test that mocks `next-intl` can still build one.
const { createFormatter } =
  await vi.importActual<typeof import("next-intl")>("next-intl");

export interface TestFormatterOptions {
  locale?: string;
  timeZone?: string;
  hourCycle?: HourCycle;
}

/**
 * What `getFormatter()` / `useFormatter()` return for one request: the app's
 * named formats in a fixed zone and hour cycle. Tests that mock `next-intl`
 * hand it out instead of a hand-rolled `dateTime`.
 */
export function createTestFormatter({
  locale = "en",
  timeZone = "UTC",
  hourCycle,
}: TestFormatterOptions = {}) {
  return createFormatter({
    locale,
    timeZone,
    formats: createFormats(hourCycle),
  });
}
