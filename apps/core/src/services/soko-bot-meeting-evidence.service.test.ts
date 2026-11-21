import { beforeEach, describe, expect, it, vi } from "vitest";
import gmailReceived from "@/lib/contacts/__fixtures__/gmail-received.json";
import gmailSent from "@/lib/contacts/__fixtures__/gmail-sent.json";
import outlookMail from "@/lib/contacts/__fixtures__/outlook-received.json";
import { fetchInboxPage } from "@/services/soko-bot-integrations.service";
import {
  bot,
  event,
  gmail,
  message,
} from "./__tests__/fixtures/soko-bot-rhythm.fixtures";

const {
  taskFindManyMock,
  userFindUniqueMock,
  memberFindManyMock,
  integrationsMock,
  calendarMock,
  inboxMock,
  confirmedContactsMock,
} = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  integrationsMock: vi.fn(),
  calendarMock: vi.fn(),
  inboxMock: vi.fn(),
  confirmedContactsMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findMany: taskFindManyMock },
    user: { findUnique: userFindUniqueMock },
    member: { findMany: memberFindManyMock },
    sokoBotIntegration: { update: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: integrationsMock,
  fetchCalendarEvents: calendarMock,
  fetchCalendarPage: async (...args: unknown[]) => {
    const events = await calendarMock(...args);
    return {
      events,
      raw: events.map((item: ReturnType<typeof event>) => ({
        id: item.id,
        start: { dateTime: item.startsAt },
        attendees: item.attendees,
        ...item.raw,
      })),
    };
  },
  fetchInboxMessages: inboxMock,
  fetchInboxPage: vi.fn(async (...args: unknown[]) => {
    const messages = await inboxMock(...args);
    return {
      messages,
      raw: messages.map((item: ReturnType<typeof message>) => ({
        ...item,
        date: item.receivedAt,
      })),
    };
  }),
}));
vi.mock("@/services/contacts-context.service", () => ({
  confirmedMeetingContacts: confirmedContactsMock,
}));

import { buildRhythmPacket } from "./soko-bot-rhythms.service";

beforeEach(() => {
  vi.clearAllMocks();
  taskFindManyMock.mockResolvedValue([]);
  memberFindManyMock.mockResolvedValue([]);
  userFindUniqueMock.mockResolvedValue({ email: "patrick@nmkr.io" });
  integrationsMock.mockResolvedValue([gmail]);
  calendarMock.mockResolvedValue([]);
  inboxMock.mockResolvedValue([]);
  confirmedContactsMock.mockResolvedValue(new Map());
});

describe("meeting prep", () => {
  // Slot 10:00–10:30 reads meetings starting 10:30–11:00.
  const slotAt = new Date("2026-10-01T10:00:00.000Z");

  it("excludes a verified workspace member invited by Gmail alias without hiding a distinct guest", async () => {
    const teammate = "tea.mmate+prep@gmail.com";
    const guest = "teammatea@gmail.com";
    memberFindManyMock.mockResolvedValue([
      { user: { email: "Team.Mate+work@GoogleMail.com" } },
    ]);
    calendarMock.mockResolvedValue([event({ attendees: [teammate, guest] })]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines.join("\n")).not.toContain(teammate);
    expect(packet.lines).toContain(`- From outside: ${guest}`);
    expect(
      inboxMock.mock.calls.map(([, options]) => options.query).join(" "),
    ).not.toContain(teammate);
    expect(memberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization: { workspace: { id: bot.workspaceId } },
          user: {
            emailVerified: true,
            OR: [
              { email: { in: [teammate, guest], mode: "insensitive" } },
              { email: { endsWith: "@gmail.com", mode: "insensitive" } },
              { email: { endsWith: "@googlemail.com", mode: "insensitive" } },
            ],
          },
        },
      }),
    );
  });

  it("accepts mail from or to owner Gmail aliases absent from the invite and excludes a similar mailbox", async () => {
    const [received] = gmailReceived.messages;
    const [sent] = gmailSent.messages;
    if (!received || !sent) throw new Error("missing Gmail fixtures");
    const guest = "nina.keller@acme-robotics.com";
    userFindUniqueMock.mockResolvedValue({ email: "ro.bin@gmail.com" });
    calendarMock.mockResolvedValue([
      event({ title: received.subject, attendees: [guest] }),
    ]);
    const raw = [
      {
        ...received,
        to: "robin+desk@googlemail.com",
        messageText: "Incoming notes",
      },
      {
        ...sent,
        sender: "R. Robin <r.o.b.i.n+send@gmail.com>",
        messageText: "Outgoing notes",
      },
      {
        ...received,
        messageId: "similar",
        to: "robina+desk@gmail.com",
        messageText: "Different mailbox",
      },
      {
        ...received,
        messageId: "invalid",
        to: "robin@gmail.com@other.example",
        messageText: "Malformed mailbox",
      },
    ].map((mail) => ({ ...mail, messageTimestamp: "2026-09-30T09:00:00Z" }));
    vi.mocked(fetchInboxPage).mockResolvedValueOnce({
      raw,
      messages: raw.map(({ messageId }) => ({
        ...message({}),
        provider: "gmail",
        id: messageId,
        snippet: "",
      })),
      nextPageToken: null,
    });
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const text = packet.lines.join("\n");
    expect(text).toContain("Incoming notes");
    expect(text).toContain("Outgoing notes");
    expect(text).not.toContain("Different mailbox");
    expect(text).not.toContain("Malformed mailbox");
  });

  it("compares and queries ordinary workspace addresses exactly", async () => {
    const member = "some.one@work.example";
    const guest = "someone+prep@work.example";
    memberFindManyMock.mockResolvedValue([{ user: { email: member } }]);
    calendarMock.mockResolvedValue([event({ attendees: [member, guest] })]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines).toContain(`- From outside: ${guest}`);
    expect(memberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization: { workspace: { id: bot.workspaceId } },
          user: {
            emailVerified: true,
            email: { in: [member, guest], mode: "insensitive" },
          },
        },
      }),
    );
  });

  it("excludes consumer Gmail owner aliases while retaining a distinct guest", async () => {
    userFindUniqueMock.mockResolvedValue({ email: "ro.bin@gmail.com" });
    const aliases = ["ro.bin+prep@gmail.com", "robin@googlemail.com"];
    const guest = "robina@gmail.com";
    calendarMock.mockResolvedValue([event({ attendees: [...aliases, guest] })]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines).toContain(`- From outside: ${guest}`);
    const query = inboxMock.mock.calls
      .map(([, options]) => options.query)
      .join(" ");
    for (const alias of aliases) expect(query).not.toContain(alias);
  });

  it("prepares an Outlook meeting when only the invited owner is in the attendee list", async () => {
    const organizer = "avery@studio.example";
    calendarMock.mockResolvedValue([
      event({
        provider: "outlook",
        attendees: ["patrick@nmkr.io"],
        raw: {
          isOrganizer: false,
          organizer: { emailAddress: { address: organizer, name: "Avery" } },
          attendees: [{ emailAddress: { address: "patrick@nmkr.io" } }],
        },
      }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines).toContain(`- From outside: Avery <${organizer}>`);
  });

  it("excludes the calendar owner across domains and retains the invite's guest names", async () => {
    const ownerAlias = "me@studio.example";
    const guests = [
      { email: ownerAlias, displayName: "Pat", self: true },
      { email: "team@studio.example", displayName: "Avery" },
      { email: "bob@different.example", displayName: "Bob" },
      { email: "another.pat@different.example", displayName: "Pat" },
      { email: "invalid@example.com to:other@example.com" },
    ];
    calendarMock.mockResolvedValue([
      event({
        attendees: guests.map((guest) => guest.email),
        raw: { attendees: guests },
      }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const text = packet.lines.join("\n");
    expect(text).not.toContain(ownerAlias);
    expect(text).toContain("Avery <team@studio.example>");
    expect(text).toContain("Bob <bob@different.example>");
    expect(text).toContain("Pat <another.pat@different.example>");
    expect(text).not.toContain("invalid@example.com");
    expect(
      inboxMock.mock.calls.map(([, options]) => options.query).join(" "),
    ).not.toContain(ownerAlias);
  });

  it("uses an Outlook organizer address only when the calendar marks it as the owner", async () => {
    const alternate = "other@studio.example";
    const partner = "team@partner.example";
    const raw = {
      isOrganizer: true,
      organizer: { emailAddress: { address: alternate, name: "Pat" } },
      attendees: [
        { emailAddress: { address: alternate, name: "Pat" } },
        { emailAddress: { address: partner, name: "Avery" } },
      ],
    };
    calendarMock.mockResolvedValue([
      event({ provider: "outlook", attendees: [alternate, partner], raw }),
    ]);
    const read = () =>
      buildRhythmPacket({
        key: "meeting-prep",
        bot,
        now: slotAt,
        dayStart: slotAt,
      });
    expect((await read()).lines.join("\n")).not.toContain(alternate);
    calendarMock.mockResolvedValue([
      event({
        provider: "outlook",
        attendees: [alternate, partner],
        raw: { ...raw, isOrganizer: false },
      }),
    ]);
    expect((await read()).lines.join("\n")).toContain(`Pat <${alternate}>`);
  });

  it("leaves a possible owner alias unclassified and never looks up that address", async () => {
    userFindUniqueMock.mockResolvedValue({ email: "alex.lee@work.example" });
    const alias = "alex.lee@studio.example";
    calendarMock.mockResolvedValue([
      event({
        attendees: [alias, "guest@studio.example", "lee@other.example"],
      }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const outside = packet.lines.find((line) =>
      line.startsWith("- From outside:"),
    );
    expect(outside).toContain("lee@other.example");
    expect(outside).not.toContain(alias);
    expect(
      packet.lines.some(
        (line) => line.includes(alias) && /unconfirmed/i.test(line),
      ),
    ).toBe(true);
    expect(
      inboxMock.mock.calls.map(([, options]) => options.query).join(" "),
    ).not.toContain(alias);
  });

  it("briefs an external meeting in its window with mail and related Tasks", async () => {
    calendarMock.mockResolvedValue([event({})]);
    inboxMock.mockResolvedValue([
      message({
        subject: "Re: Intro call",
        snippet: "I will bring the draft.",
      }),
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: "task-1",
        name: "Prepare proposal for Intro call",
        status: "RUNNING",
      },
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(packet.skip).toBe(false);
    const text = packet.lines.join("\n");
    expect(text).toContain("Intro call");
    expect(text).toContain("From outside: anna@acme.com");
    expect(text).toContain("I will bring the draft.");
    expect(text).toContain('"Prepare proposal for Intro call"');
    expect(calendarMock).toHaveBeenCalledWith(gmail, {
      from: new Date("2026-10-01T10:30:00.000Z"),
      to: new Date("2026-10-01T11:00:00.000Z"),
      limit: 10,
    });
  });

  it("links only the confirmed guest to their contact details", async () => {
    calendarMock.mockResolvedValue([
      event({
        attendees: [
          "patrick@nmkr.io",
          "Anna [Muster] <anna@acme.com>",
          "new@x.io",
        ],
      }),
    ]);
    confirmedContactsMock.mockResolvedValue(
      new Map([["anna@acme.com", { id: "c-1", role: "CEO @ Acme" }]]),
    );
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(confirmedContactsMock).toHaveBeenCalledWith("ws-1", [
      { email: "anna@acme.com", name: "Anna [Muster]" },
      { email: "new@x.io", name: null },
    ]);
    expect(packet.lines).toContain(
      "- From outside: [Anna \\[Muster\\]](/contacts?contact=c-1&workspace=ws-1) <anna@acme.com> (CEO @ Acme), new@x.io",
    );
  });

  it("still preps the meeting when the Contacts lookup fails", async () => {
    calendarMock.mockResolvedValue([event({})]);
    confirmedContactsMock.mockRejectedValue(new Error("db down"));
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(packet.skip).toBe(false);
    expect(packet.lines.join("\n")).toContain("From outside: anna@acme.com");
  });

  it("keeps older mail about this meeting and drops calendar notices", async () => {
    calendarMock.mockResolvedValue([
      event({
        title: "Masumi deck",
        link: "https://calendar.example/event/deck",
        attendees: ["patrick@nmkr.io", "ingo@hoc.de", "andric@hoc.de"],
      }),
    ]);
    inboxMock.mockImplementation(async (_integration, options) =>
      options.query.includes("andric@hoc.de")
        ? [
            message({
              id: "m-2",
              from: "Andric <andric@hoc.de>",
              subject: "Re: Masumi deck",
              snippet:
                "Here's the brief for https://calendar.example/event/deck",
              receivedAt: "2026-06-02T09:00:00.000Z",
            }),
          ]
        : [
            message({
              from: "Ingo <ingo@hoc.de>",
              subject: "Accepted: Next Steps Masumi @ Thu 2 Oct",
            }),
          ],
    );
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    const text = packet.lines.join("\n");
    expect(inboxMock).toHaveBeenCalledWith(gmail, {
      query: "{from:andric@hoc.de to:andric@hoc.de} -filename:ics",
      since: new Date("2025-10-01T10:00:00.000Z"),
      before: slotAt,
      includePayload: true,
      limit: 8,
    });
    expect(text).toContain("Earlier mail with andric@hoc.de:");
    expect(text).toContain("Re: Masumi deck");
    expect(text).not.toContain("No mail");
    expect(text).not.toContain("Accepted:");
  });

  it("keeps mail about simultaneous meetings in the corresponding meeting section", async () => {
    calendarMock.mockResolvedValue([
      event({ title: "Water cooler talk" }),
      event({ id: "ev-2", title: "Product review" }),
    ]);
    inboxMock.mockResolvedValue([
      message({ subject: "Re: Product review", snippet: "Bring the roadmap" }),
      message({
        id: "m-2",
        subject: "Can we meet?",
        snippet: "Either slot works",
      }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const sections = packet.lines.join("\n").split("## Meeting ");
    expect(sections[1]).toContain("Water cooler talk");
    expect(sections[1]).not.toContain("Bring the roadmap");
    expect(sections[2]).toContain("Product review");
    expect(sections[2]).toContain("Bring the roadmap");
    expect(packet.lines.join("\n")).not.toContain("Either slot works");
  });

  it("uses the event link when two invites have the same title and attendees", async () => {
    const shortLink = "https://calendar.example/event/1";
    const longLink = "https://calendar.example/event/10";
    calendarMock.mockResolvedValue([
      event({ link: shortLink }),
      event({ id: "ev-2", link: longLink }),
    ]);
    inboxMock.mockResolvedValue([
      message({
        from: "patrick@nmkr.io",
        to: ["anna@acme.com"],
        subject: "Re: Intro call",
        snippet: `Please review the designs for ${longLink}`,
        receivedAt: "2026-08-15T08:00:00Z",
      }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const sections = packet.lines.join("\n").split("## Meeting ");
    expect(sections[1]).not.toContain("Please review the designs");
    expect(sections[2]).toContain("Please review the designs");
  });

  it("rejects links to a different occurrence even if only today's invite is in the slot", async () => {
    const link = "https://www.google.com/calendar/event?eid=today";
    const previous = "https://www.google.com/calendar/event?eid=yesterday";
    const differentProvider =
      "https://outlook.office.com/calendar/item/previous";
    calendarMock.mockResolvedValue([event({ title: "Team review", link })]);
    inboxMock.mockResolvedValue([
      message({ subject: "Re: Team review", snippet: `Old notes ${previous}` }),
      message({
        id: "m-2",
        subject: "Re: Team review",
        snippet: `Both ${link} and ${differentProvider}`,
      }),
      message({
        id: "m-3",
        subject: "Re: Team review",
        snippet: "Read https://docs.example/report",
      }),
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: "old",
        name: `Team review notes ${differentProvider}`,
        status: "READY",
      },
      { id: "today", name: `Prepare Team review ${link}`, status: "READY" },
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const text = packet.lines.join("\n");
    expect(text).not.toMatch(/Old notes|Both |Team review notes/);
    expect(text).toContain("https://docs.example/report");
    expect(text).toContain("Prepare Team review");
  });

  it("rejects a conflicting calendar link in the full body or a mixed-case Outlook item link", async () => {
    const today = "https://www.google.com/calendar/event?eid=today";
    const yesterday = "https://www.google.com/calendar/event?eid=yesterday";
    const outlook =
      "https://outlook.office365.com/owa/?ItemID=yesterday&path=/calendar/item";
    calendarMock.mockResolvedValue([
      event({ title: "Team review", link: today }),
    ]);
    inboxMock.mockResolvedValue([
      message({
        subject: "Re: Team review",
        snippet: "Prior agenda",
        messageText: `Notes here: ${yesterday}`,
      }),
      message({
        id: "m2",
        subject: "Re: Team review",
        snippet: "Last calendar item",
        body: {
          contentType: "html",
          content: `<a href="${outlook}">Previous review</a>`,
        },
      }),
      message({
        id: "m3",
        subject: "Re: Team review",
        snippet: "Current agenda",
      }),
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: "old",
        name: "Team review https://outlook.office365.com/owa/?ItemID=yesterday",
        status: "READY",
      },
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines.join("\n")).not.toMatch(
      /Prior agenda|Last calendar item|id old/,
    );
    expect(packet.lines.join("\n")).toContain("Current agenda");
  });

  it.each(["gmail", "outlook"])(
    "bounds the %s participant search before newer mail can displace the original evidence",
    async (provider) => {
      integrationsMock.mockResolvedValue([{ provider: { id: provider } }]);
      calendarMock.mockResolvedValue([event({})]);
      inboxMock.mockImplementation(async (_integration, options) => {
        const bounded =
          provider === "gmail"
            ? options.before?.getTime() === slotAt.getTime()
            : options.query.includes("received<" + slotAt.toISOString());
        return bounded
          ? [message({ subject: "Intro call", snippet: "Original notes" })]
          : [
              message({
                subject: "Intro call",
                snippet: "Next month",
                receivedAt: "2026-11-01T10:00:00Z",
              }),
            ];
      });
      const packet = await buildRhythmPacket({
        key: "meeting-prep",
        bot,
        now: slotAt,
        dayStart: slotAt,
      });
      expect(packet.lines.join("\n")).toContain("Original notes");
    },
  );

  it("finds an older matching Task after a page of weak matches", async () => {
    calendarMock.mockResolvedValue([event({ title: "Design review" })]);
    taskFindManyMock.mockImplementation(async ({ cursor, take }) => {
      if (cursor)
        return [{ id: "older", name: "Design review", status: "READY" }];
      return Array.from({ length: take }, (_, i) => ({
        id: `weak-${i}`,
        name: "Design reviewing proposal",
        status: "READY",
      }));
    });
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines.join("\n")).toContain('"Design review" (id older)');
  });

  it("uses the Outlook body for a bounded event link and excerpt when the preview is missing", async () => {
    const [received] = outlookMail.value;
    if (!received) throw new Error("missing Outlook mail fixture");
    const link = "https://calendar.example/event/contract";
    const actual = {
      ...received,
      receivedDateTime: "2026-09-01T08:00:00Z",
      body: {
        ...received.body,
        content: `${received.body.content}<p>${link}</p>`,
      },
    };
    const unrelated = {
      ...actual,
      id: "old-unrelated",
      body: {
        contentType: "text",
        content: `${"Unrelated archive. ".repeat(32)}${link}`,
      },
    };
    userFindUniqueMock.mockResolvedValue({ email: "patrick@yellowhouse.gmbh" });
    integrationsMock.mockResolvedValue([{ provider: { id: "outlook" } }]);
    calendarMock.mockResolvedValue([
      event({
        provider: "outlook",
        title: "Launch planning",
        link,
        attendees: ["ana.silva@lawfirm.pt"],
      }),
    ]);
    vi.mocked(fetchInboxPage).mockResolvedValueOnce({
      raw: [actual, unrelated],
      messages: [actual, unrelated].map(({ id }) => ({
        ...message({}),
        provider: "outlook",
        id,
        snippet: "",
      })),
      nextPageToken: null,
    });
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const text = packet.lines.join("\n");
    expect(text).toContain("please find the draft attached.");
    expect(text).not.toContain("Unrelated archive.");
  });

  it("rejects unrelated search hits, stale direct mail and forwarded RSVPs", async () => {
    calendarMock.mockResolvedValue([event({})]);
    inboxMock.mockResolvedValue([
      message({
        from: "Casey <casey@elsewhere.example>",
        subject: "Casey's 15:30 call",
      }),
      message({
        id: "m-2",
        subject: "Re: Intro call",
        snippet: "An older meeting with the same title.",
        receivedAt: "2026-01-01T08:00:00Z",
      }),
      message({ id: "m-3", subject: "Fwd: Angenommen: Other call" }),
      message({
        id: "m-4",
        subject: "Re: Intro call",
        snippet: "I will bring the proposal.",
      }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const text = packet.lines.join("\n");
    expect(text).toContain("I will bring the proposal.");
    expect(text).not.toMatch(/Casey's 15:30 call|An older meeting|Other call/);
  });

  it("searches Outlook by participant", async () => {
    const outlook = { provider: { id: "outlook" } };
    integrationsMock.mockResolvedValue([outlook]);
    calendarMock.mockResolvedValue([event({})]);
    await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(inboxMock).toHaveBeenCalledWith(
      outlook,
      expect.objectContaining({
        query: `participants:anna@acme.com AND received<${slotAt.toISOString()}`,
      }),
    );
  });

  it("keeps a company or a shared guest from attaching Tasks to unrelated meetings", async () => {
    calendarMock.mockResolvedValue([
      event({ title: "Budget review" }),
      event({
        id: "ev-2",
        title: "Product review",
        attendees: ["patrick@nmkr.io", "anna@acme.com", "bob@acme.com"],
      }),
    ]);
    // The old company key was "acme" for anna@acme.com; null for freemail, where the domain names no company.
    // The first Task matched that key despite having no link to either meeting.
    taskFindManyMock.mockResolvedValue([
      { id: "t1", name: "General Acme outreach", status: "READY" },
      { id: "t2", name: "Email anna@acme.com", status: "READY" },
      { id: "t3", name: "Prepare for Budget review", status: "READY" },
      { id: "t4", name: "Get specs from bob@acme.com", status: "READY" },
      { id: "t5", name: "Email bob@acme.com.au", status: "READY" },
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const sections = packet.lines.join("\n").split("## Meeting ");
    expect(sections[1]).toContain("Prepare for Budget review");
    expect(sections[1]).not.toContain("Get specs from");
    expect(sections[2]).not.toContain("Get specs from bob@acme.com");
    expect(sections[2]).not.toContain("Prepare for Budget review");
    expect(packet.lines.join("\n")).not.toMatch(
      /General Acme outreach|Email anna|bob@acme.com.au/,
    );
  });

  it("does not attach another meeting's Task just because its guest is in this slot", async () => {
    calendarMock.mockResolvedValue([event({ title: "Product review" })]);
    taskFindManyMock.mockResolvedValue([
      {
        id: "other",
        name: "Send Budget review projections to anna@acme.com",
        status: "READY",
      },
      { id: "this", name: "Prepare Product review", status: "READY" },
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines.join("\n")).not.toContain("Budget review");
    expect(packet.lines.join("\n")).toContain("Prepare Product review");
  });

  it("requires a link to this occurrence for a recurring meeting's mail and Tasks", async () => {
    const link = "https://www.google.com/calendar/event?eid=occurrence";
    calendarMock.mockResolvedValue([
      event({ link, raw: { recurringEventId: "series" } }),
    ]);
    inboxMock.mockResolvedValue([
      message({ subject: "Re: Intro call", snippet: "Prior occurrence" }),
      message({
        id: "m-2",
        subject: "Re: Intro call",
        snippet: `Current occurrence ${link}`,
      }),
    ]);
    taskFindManyMock.mockResolvedValue([
      { id: "unplaced", name: "Prep Intro call", status: "READY" },
      { id: "placed", name: `Prepare ${link}`, status: "READY" },
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.lines.join("\n")).not.toMatch(
      /Prior occurrence|Prep Intro call/,
    );
    expect(packet.lines.join("\n")).toContain("Current occurrence");
    expect(packet.lines.join("\n")).toContain("id placed");
  });

  it("excludes a recent direct conversation about another meeting with the same guest", async () => {
    calendarMock.mockResolvedValue([event({ title: "Water cooler talk" })]);
    inboxMock.mockResolvedValue([
      message({
        subject: "Re: Budget review",
        snippet: "The budget meeting moved to 15:30.",
      }),
      message({
        id: "m-2",
        subject: "Re: Water cooler talk",
        snippet: "Let's talk about the launch.",
      }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    const text = packet.lines.join("\n");
    expect(text).toContain("Let's talk about the launch.");
    expect(text).not.toContain("The budget meeting moved to 15:30.");
  });

  it("skips internal meetings and meetings outside the window", async () => {
    calendarMock.mockResolvedValue([
      event({ attendees: ["patrick@nmkr.io", "albina@nmkr.io"] }),
      event({ id: "ev-2", startsAt: "2026-10-01T11:10:00.000Z" }),
    ]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(packet).toEqual({ lines: [], skip: true });
  });

  it("skips without a calendar", async () => {
    integrationsMock.mockResolvedValue([]);
    const packet = await buildRhythmPacket({
      key: "meeting-prep",
      bot,
      now: slotAt,
      dayStart: slotAt,
    });
    expect(packet.skip).toBe(true);
  });
});
