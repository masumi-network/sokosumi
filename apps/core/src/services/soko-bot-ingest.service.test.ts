import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class extends Error {},
  sokoBotControlPlane: {},
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({}));

import type { SokoBotInboxMessage } from "@sokosumi/soko-bot";
import type { TriagedMail } from "@/lib/soko-bot/mail-triage";
import {
  briefingDue,
  buildIngestMessage,
  localClock,
} from "./soko-bot-ingest.service";

const urgent = (message: SokoBotInboxMessage): TriagedMail => ({
  message,
  tag: "URGENT",
  probability: 0.9,
  matchesRule: false,
});

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
        urgent({
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
        }),
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
    expect(message).toContain("triaged by Jev");
    expect(message).toContain("a guide, not a fact");
    expect(message).toContain(
      "**Contract draft** — Can you review by Friday? [gmail:m1] · urgent 90%",
    );
  });

  it("puts the people from Contacts between the calendar and the mail", () => {
    const message = buildIngestMessage({
      kind: "briefing",
      timeZone: "UTC",
      mail: [
        urgent({
          provider: "gmail",
          id: "m1",
          threadId: null,
          from: "ana@example.com",
          to: [],
          subject: "Hello",
          snippet: "",
          receivedAt: "2026-08-26T05:00:00Z",
          unread: false,
          labels: [],
        }),
      ],
      events: [
        {
          provider: "googlecalendar",
          id: "e1",
          title: "Pilot kickoff",
          startsAt: "2026-08-26T07:00:00Z",
          endsAt: null,
          allDay: false,
          location: null,
          attendees: ["nina@acme.com"],
          organizer: null,
          description: null,
          link: null,
        },
      ],
      people: [
        "## People on your calendar (from Contacts)",
        "- Nina Keller — CEO @ Acme · known by Bob (2)",
        "",
      ],
    });
    const calendar = message.indexOf("## Calendar");
    const people = message.indexOf("## People on your calendar");
    const mail = message.indexOf("## Mail");
    expect(calendar).toBeLessThan(people);
    expect(people).toBeLessThan(mail);
  });

  it("tells the bot to act on mail a saved rule matches", () => {
    const message = buildIngestMessage({
      kind: "delta",
      timeZone: "UTC",
      mail: [
        {
          ...urgent({
            provider: "gmail",
            id: "inv",
            threadId: null,
            from: "billing@acme.com",
            to: [],
            subject: "Invoice 42",
            snippet: "",
            receivedAt: "2026-08-26T05:00:00Z",
            unread: true,
            labels: [],
          }),
          tag: "BULK",
          matchesRule: true,
        },
      ],
      events: [],
    });
    expect(message).toContain("`save_email_attachment`");
    expect(message).toContain("Matches a saved rule");
    expect(message).toContain("[gmail:inv]");
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
