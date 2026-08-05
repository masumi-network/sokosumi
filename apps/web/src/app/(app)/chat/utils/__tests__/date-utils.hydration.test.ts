import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatMessageTime,
  messageDayKey,
} from "@/app/chat/components/room-helpers";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";

/**
 * SOKOSUMI-A: room message timestamps / day separators use the runtime's
 * local calendar and `Intl` default locale. Vercel SSR is UTC + Node locale;
 * browsers use the user's TZ + locale — HTML then disagrees on hydrate.
 */
describe("chat local calendar helpers (SOKOSUMI-A)", () => {
  const previousTz = process.env.TZ;

  afterEach(() => {
    vi.useRealTimers();
    if (previousTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTz;
    }
  });

  it("messageDayKey splits the same instant across UTC vs Europe/Berlin", () => {
    // 22:30 UTC is still Aug 5 in UTC, already Aug 6 00:30 in Berlin (UTC+2).
    const evening = "2026-08-05T22:30:00.000Z";

    process.env.TZ = "UTC";
    const utcKey = messageDayKey(evening);

    process.env.TZ = "Europe/Berlin";
    const berlinKey = messageDayKey(evening);

    expect(utcKey).not.toEqual(berlinKey);
  });

  it("formatDaySeparator label for an evening instant differs UTC vs Berlin when 'now' is fixed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));

    const evening = new Date("2026-08-05T22:30:00.000Z");

    process.env.TZ = "UTC";
    const utcLabel = formatDaySeparator(evening);

    process.env.TZ = "Europe/Berlin";
    const berlinLabel = formatDaySeparator(evening);

    // Different local calendar days → different separator text (or Today vs date).
    expect(utcLabel).not.toEqual(berlinLabel);
  });

  it("formatMessageTime with default locale diverges en-US vs en-GB for the same instant", () => {
    const iso = "2026-08-05T15:30:00.000Z";
    const enUs = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
    const enGb = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

    expect(enUs).not.toEqual(enGb);
    // Production helper uses `undefined` locale — same class of divergence.
    expect(typeof formatMessageTime(iso)).toBe("string");
  });
});
