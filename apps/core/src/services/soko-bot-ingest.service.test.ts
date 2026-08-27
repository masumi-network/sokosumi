import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class extends Error {},
  sokoBotControlPlane: {},
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({}));

import {
  briefingDue,
  buildIngestMessage,
  localClock,
} from "./soko-bot-ingest.service";

describe("soko-bot ingest", () => {
  it("reads the local clock in the bot's timezone", () => {
    const clock = localClock(new Date("2026-08-26T06:30:00Z"), "Europe/Berlin");
    expect(clock).toEqual({ hour: 8, date: "2026-08-26" });
  });

  it("sends one briefing per local day from 07:00", () => {
    const tz = "Europe/Berlin";
    expect(briefingDue(new Date("2026-08-26T04:30:00Z"), tz, null)).toBe(false);
    expect(briefingDue(new Date("2026-08-26T05:30:00Z"), tz, null)).toBe(true);
    expect(
      briefingDue(
        new Date("2026-08-26T09:00:00Z"),
        tz,
        new Date("2026-08-26T05:31:00Z"),
      ),
    ).toBe(false);
    expect(
      briefingDue(
        new Date("2026-08-27T05:30:00Z"),
        tz,
        new Date("2026-08-26T05:31:00Z"),
      ),
    ).toBe(true);
  });

  it("builds a compact packet with ids the bot can read back", () => {
    const message = buildIngestMessage({
      kind: "briefing",
      timeZone: "Europe/Berlin",
      mail: [
        {
          provider: "gmail",
          id: "m1",
          threadId: null,
          from: "Ana <ana@example.com>",
          to: [],
          subject: "Contract draft",
          snippet: "Can you  review\nby Friday?",
          receivedAt: "2026-08-26T05:00:00Z",
          unread: true,
          labels: [],
        },
      ],
      events: [
        {
          provider: "googlecalendar",
          id: "e1",
          title: "Standup",
          startsAt: "2026-08-26T07:00:00Z",
          endsAt: "2026-08-26T07:15:00Z",
          allDay: false,
          location: null,
          attendees: ["bob@example.com"],
          organizer: null,
          description: null,
          link: null,
        },
      ],
    });
    expect(message).toContain("Morning briefing");
    expect(message).toContain("Standup");
    expect(message).toContain("[googlecalendar:e1]");
    expect(message).toContain(
      "**Contract draft** — Can you review by Friday? [gmail:m1]",
    );
  });

  it("says so when a delta packet is empty", () => {
    const message = buildIngestMessage({
      kind: "delta",
      timeZone: "UTC",
      mail: [],
      events: [],
    });
    expect(message).toContain("Nothing new in mail or calendar.");
  });
});
