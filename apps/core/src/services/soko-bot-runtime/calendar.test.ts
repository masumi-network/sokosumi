import type {
  SokoBotCalendarEvent,
  SokoBotCapability,
} from "@sokosumi/soko-bot";
import { beforeEach, expect, it, vi } from "vitest";
import { listCalendarEvents } from "./calendar";

const { findChannels, findTurn, fetchEvents } = vi.hoisted(() => ({
  findChannels: vi.fn(),
  findTurn: vi.fn(),
  fetchEvents: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findUnique: async () => ({ ingestTimezone: "UTC" }) },
    sokoBotTurn: { findFirst: findTurn },
    contactChannel: { findMany: findChannels },
  },
}));
vi.mock("@/services/soko-bot-integrations.service", async (load) => ({
  ...(await load<object>()),
  activeIntegrationsForBot: async () => [
    { id: "later-account" },
    { id: "earlier-account" },
  ],
  fetchCalendarEvents: fetchEvents,
}));

const workspaceId = "018f0000-0000-7000-8000-000000000001";
const id = "018f0000-0000-7000-8000-000000000002";
const guest = "press@paper.example";
const organizer = "rene@paper.example";
const event: SokoBotCalendarEvent = {
  id: "e",
  title: "Review",
  provider: "googlecalendar",
  startsAt: "2026-11-19T15:00:00Z",
  endsAt: null,
  allDay: false,
  location: null,
  description: null,
  link: "https://example.test/calendar/e",
  attendees: [`Paper <${guest}>`, "Unknown <unknown@paper.example>"],
  organizer: `Rene <${organizer}>`,
};
const capabilities: SokoBotCapability[] = [
  "list_calendar_events",
  "search_contacts",
];
const scope = {
  turn: {
    id: "turn",
    sokoBotId: "bot",
    workspaceId,
    actingUserId: "member",
    source: "CHAT",
    chainDepth: 0,
  },
  grant: { capabilities },
};

beforeEach(() => {
  vi.resetAllMocks();
  fetchEvents.mockImplementation(async ({ id }: { id: string }) =>
    id === "later-account"
      ? [
          {
            ...event,
            id: "later",
            startsAt: "2026-11-20T16:00:00Z",
            attendees: ["past-limit@paper.example"],
          },
        ]
      : [event],
  );
  findTurn.mockResolvedValue({
    destinationRoomId: "room",
    chatMention: { message: { roomId: "room" } },
  });
  findChannels.mockResolvedValue([
    {
      value: guest,
      contact: {
        id,
        kind: "PERSON",
        name: "Micah (Paper)",
        role: null,
        organization: "Paper",
      },
    },
    {
      value: organizer,
      contact: {
        id: "c-2",
        kind: "PERSON",
        name: "Rene",
        role: null,
        organization: null,
      },
    },
  ]);
});

it("links the invite mailbox despite a stale CRM name and limits references to the returned event", async () => {
  const result = await listCalendarEvents(scope, { limit: 1 });
  expect(result.events).toMatchObject([
    {
      id: event.id,
      attendees: event.attendees,
      organizer: event.organizer,
      link: event.link,
      contactReferences: [
        {
          email: guest,
          link: `/contacts?contact=${id}&workspace=${workspaceId}`,
        },
        {
          email: organizer,
          name: "Rene",
          link: `/contacts?contact=c-2&workspace=${workspaceId}`,
        },
      ],
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("Micah");
  expect(findChannels).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        workspaceId,
        type: "EMAIL",
        value: { in: [guest, "unknown@paper.example", organizer] },
        contact: {
          workspaceId,
          archivedAt: null,
          mergedIntoId: null,
        },
      },
    }),
  );
});

it("keeps the invite readable without the Contacts grant or an authorized audience", async () => {
  const call = (caps: SokoBotCapability[]) =>
    listCalendarEvents(
      { ...scope, grant: { capabilities: caps } },
      { limit: 1 },
    );
  const calendarOnly = await call(["list_calendar_events"]);
  expect(calendarOnly.events[0]).toMatchObject({
    id: event.id,
    attendees: event.attendees,
  });
  expect(calendarOnly.events[0]).not.toHaveProperty("contactReferences");
  expect(findTurn).not.toHaveBeenCalled();
  findTurn.mockResolvedValue(null);
  const unauthorized = await call(capabilities);
  expect(unauthorized.events[0]).not.toHaveProperty("contactReferences");
  expect(findChannels).not.toHaveBeenCalled();
});

it("drops optional contact evidence on a directory failure without losing the calendar event", async () => {
  findChannels.mockRejectedValue(new Error("database unavailable"));
  const result = await listCalendarEvents(scope, { limit: 1 });
  expect(result.events[0]).toMatchObject({
    id: event.id,
    attendees: event.attendees,
    link: event.link,
  });
  expect(result.events[0]).not.toHaveProperty("contactReferences");
});
