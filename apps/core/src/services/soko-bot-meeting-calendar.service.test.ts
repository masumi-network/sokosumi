import { beforeEach, describe, expect, it, vi } from "vitest";
import googleEvents from "@/lib/contacts/__fixtures__/googlecalendar-events.json";
import outlookEvents from "@/lib/contacts/__fixtures__/outlook-events.json";

const { integrations, readPage, stamp } = vi.hoisted(() => ({
  integrations: vi.fn(),
  readPage: vi.fn(),
  stamp: vi.fn(),
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: integrations,
  fetchCalendarPage: readPage,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotIntegration: { update: stamp } },
}));

import { meetingCalendarEvents } from "./soko-bot-meeting-calendar.service";

const from = new Date("2026-10-15T13:30:00Z");
const to = new Date("2026-10-15T14:30:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  integrations.mockResolvedValue([{ id: "calendar" }]);
  stamp.mockResolvedValue({});
});

describe("meetingCalendarEvents", () => {
  it("includes an external Google organizer when the roster is omitted and respects owner and attendee flags", async () => {
    const [owned, external] = googleEvents.items;
    if (!owned?.organizer || !external?.organizer)
      throw new Error("missing Google organizer fixtures");
    const raw = [
      { ...external, attendeesOmitted: true, attendees: undefined },
      { ...owned, attendees: undefined },
      {
        ...external,
        id: "declined",
        attendees: [{ ...external.organizer, responseStatus: "declined" }],
      },
      {
        ...external,
        id: "calendar-resource",
        attendees: undefined,
        organizer: { email: "room@resource.calendar.google.com" },
      },
    ];
    readPage.mockResolvedValue({
      raw,
      events: raw.map(({ id }) => ({
        id,
        attendees: [],
        startsAt: from.toISOString(),
      })),
    });
    const events = await meetingCalendarEvents("bot", from, to, 10);
    const byId = new Map(events.map((event) => [event.id, event]));
    expect(byId.get(external.id)?.guests).toEqual([
      { email: external.organizer.email, name: null },
    ]);
    expect(byId.get(owned.id)?.selfEmails).toContain(owned.organizer.email);
    for (const id of [owned.id, "declined", "calendar-resource"])
      expect(byId.get(id)?.guests).toEqual([]);
  });

  it("reads the Outlook owner from their organizer response when isOrganizer is missing", async () => {
    const [meeting] = outlookEvents.value;
    if (!meeting) throw new Error("missing Outlook fixture");
    readPage.mockResolvedValue({
      events: [{ id: meeting.id, attendees: [], startsAt: from.toISOString() }],
      raw: [meeting],
    });
    const [event] = await meetingCalendarEvents("bot", from, to, 10);
    expect(event?.startsAt).toBe("2026-10-15T14:00:00.000Z");
    expect(event?.selfEmails).toContain("patrick@yellowhouse.gmbh");
    expect(event?.guests).toEqual([
      { email: "ana.silva@lawfirm.pt", name: "Ana Silva" },
    ]);
    expect(stamp).toHaveBeenCalledWith({
      where: { id: "calendar" },
      data: { lastIngestAt: expect.any(Date) },
    });
  });

  it("resolves named local times, keeps all-day dates and skips unresolvable times", async () => {
    const local = "2026-10-15T14:00:00.500";
    const raw = [
      { id: "oslo", start: { dateTime: local, timeZone: "Europe/Oslo" } },
      {
        id: "unsupported",
        start: { dateTime: local, timeZone: "Unrecognized/Zone" },
      },
      { id: "unspecified", start: { dateTime: local } },
      {
        id: "ambiguous",
        start: { dateTime: "2026-10-25T02:30:00", timeZone: "Europe/Oslo" },
      },
      { id: "all-day", start: { date: "2026-10-15" } },
    ];
    readPage.mockResolvedValue({
      raw,
      events: raw.map(({ id }) => ({
        id,
        attendees: [],
        startsAt: from.toISOString(),
        allDay: false,
      })),
    });
    const events = await meetingCalendarEvents("bot", from, to, 10);
    expect(
      events.map(({ id, startsAt, allDay }) => ({ id, startsAt, allDay })),
    ).toEqual([
      { id: "all-day", startsAt: "2026-10-15T00:00:00.000Z", allDay: true },
      { id: "oslo", startsAt: "2026-10-15T12:00:00.500Z", allDay: false },
    ]);
  });

  it("interprets an offset-free Windows zone using its daylight and standard time rules", async () => {
    const windows = "W. Europe Standard Time";
    const raw = ["2026-07-01", "2026-12-01"].map((date) => ({
      id: date,
      start: { dateTime: `${date}T14:30:00.0000000`, timeZone: windows },
    }));
    readPage.mockResolvedValue({
      raw,
      events: raw.map(({ id }) => ({
        id,
        startsAt: from.toISOString(),
        attendees: [],
      })),
    });
    const events = await meetingCalendarEvents("bot", from, to, 10);
    expect(events.map(({ startsAt }) => startsAt)).toEqual([
      "2026-07-01T12:30:00.000Z",
      "2026-12-01T13:30:00.000Z",
    ]);
  });

  it("marks recurring provider occurrences while preserving a single event", async () => {
    const markers = [
      { recurringEventId: "weekly" },
      { seriesMasterId: "series" },
      { recurrence: ["RRULE:FREQ=WEEKLY"] },
      { recurrence: { pattern: { type: "weekly" } } },
      { type: "occurrence" },
      { type: "exception" },
      { type: "seriesMaster" },
      { type: "singleInstance", recurrence: null, seriesMasterId: null },
      { recurrence: [] },
    ];
    const raw = markers.map((marker, i) => ({
      id: String(i),
      start: { dateTime: from.toISOString() },
      ...marker,
    }));
    readPage.mockResolvedValue({
      raw,
      events: raw.map(({ id }) => ({
        id,
        startsAt: from.toISOString(),
        attendees: [],
      })),
    });
    const events = await meetingCalendarEvents("bot", from, to, 10);
    expect(events.map((event) => event.recurring)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("preserves guests from a flattened provider roster, including quoted names", async () => {
    const attendees =
      'Avery <team@studio.example>, "Baker, Robin" <robin@other.example>';
    readPage.mockResolvedValue({
      raw: [{ id: "flat", start: { dateTime: from.toISOString() }, attendees }],
      events: [
        {
          id: "flat",
          startsAt: from.toISOString(),
          attendees: attendees.split(","),
        },
      ],
    });
    const [event] = await meetingCalendarEvents("bot", from, to, 10);
    expect(event?.guests).toEqual([
      { email: "team@studio.example", name: "Avery" },
      { email: "robin@other.example", name: "Robin Baker" },
    ]);
  });

  it.each(["structured", "flattened"])(
    "uses an address once when %s invitation names conflict",
    async (shape) => {
      const roster = [
        { email: "TEAM@studio.example", displayName: "Morgan" },
        { email: "team@studio.example", displayName: "Avery" },
        { email: "team@studio.example", displayName: "Morgan" },
        { email: "contact@other.example" },
        { email: "contact@other.example", displayName: "Robin Baker" },
        { email: "contact@other.example", displayName: "ROBIN BAKER" },
        { email: "bob@third.example", displayName: "Bob" },
        { email: "bob@third.example", displayName: "Alex" },
      ];
      const attendees =
        shape === "structured"
          ? roster
          : roster
              .map(({ email, displayName }) =>
                displayName ? `${displayName} <${email}>` : email,
              )
              .join(", ");
      readPage.mockResolvedValue({
        raw: [
          { id: "dupes", start: { dateTime: from.toISOString() }, attendees },
        ],
        events: [{ id: "dupes", startsAt: from.toISOString(), attendees: [] }],
      });
      const [event] = await meetingCalendarEvents("bot", from, to, 10);
      expect(event?.guests).toEqual([
        { email: "team@studio.example", name: null },
        { email: "contact@other.example", name: "Robin Baker" },
        { email: "bob@third.example", name: null },
      ]);
    },
  );

  it("omits canceled, declined and personal time blocks while preserving private meetings", async () => {
    const base = {
      start: { dateTime: from.toISOString() },
      attendees: [{ email: "guest@example.com" }],
    };
    const raw = [
      { ...base, id: "canceled", isCancelled: true },
      { ...base, id: "declined", responseStatus: { response: "declined" } },
      { ...base, id: "focus", eventType: "focusTime" },
      { ...base, id: "away", showAs: "oof" },
      { ...base, id: "private", sensitivity: "private", visibility: "private" },
    ];
    readPage.mockResolvedValue({
      raw,
      events: raw
        .toReversed()
        .map(({ id }) => ({ id, attendees: [], startsAt: from.toISOString() })),
    });
    const events = await meetingCalendarEvents("bot", from, to, 10);
    expect(events.map(({ id }) => id)).toEqual(["private"]);
    expect(events[0]?.guests).toEqual([
      { email: "guest@example.com", name: null },
    ]);
  });
});
