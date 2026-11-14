import { getSokoBotIntegrationProvider } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import type { MailboxFixtureBinding } from "./mailbox-binding";

const REFERENCE_TIME = "2026-11-14T12:00:00.000Z";
const binding: MailboxFixtureBinding = {
  version: 1,
  resultId: "00000000-0000-7000-8000-000000000001",
  runId: "00000000-0000-7000-8000-000000000002",
  caseId: "inbox-summary",
  repeat: 1,
  referenceTime: REFERENCE_TIME,
  userId: "owner-one",
  organizationId: "organization-one",
  workspaceId: "00000000-0000-7000-8000-000000000003",
  sokoBotId: "00000000-0000-7000-8000-000000000004",
  clientTurnId: "lab:eval:00000000-0000-7000-8000-000000000001",
  source: "CHAT",
};
const gmail = getSokoBotIntegrationProvider("gmail")!;
const calendar = getSokoBotIntegrationProvider("googlecalendar")!;

// Loading in the test lets the pre-implementation run count missing support
// as failed cases, rather than stopping before Vitest collects any tests.
const modulePath = "./mailbox-provider-fixtures.ts";
async function execute(
  fixture: MailboxFixtureBinding,
  provider: string,
  slug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { executeMailboxFixture } = await import(modulePath);
  return executeMailboxFixture(fixture, provider, slug, args);
}

function list(args: Record<string, unknown> = {}, fixture = binding) {
  return execute(fixture, "gmail", gmail.tools.listMessages!, args);
}

function events(fixture = binding, args: Record<string, unknown> = {}) {
  return execute(fixture, "googlecalendar", calendar.tools.listEvents!, {
    calendar_id: "primary",
    timeMin: "2026-11-14T00:00:00.000Z",
    timeMax: "2026-11-17T00:00:00.000Z",
    single_events: true,
    order_by: "startTime",
    ...args,
  });
}

function rows(result: Record<string, unknown>, key = "messages") {
  return result[key] as Array<Record<string, unknown>>;
}

describe("mailbox provider fixtures", () => {
  it.each([
    ["inbox-summary", 6],
    ["calendar-prep", 3],
    ["standup-with-inbox", 6],
    ["mail-delta", 6],
    ["quiet-standup", 3],
    ["quiet-delta", 3],
    ["autonomous-meeting-prep", 3],
  ] as const)(
    "provides source data for %s without a live account",
    async (caseId, count) => {
      const messages = rows(await list({}, { ...binding, caseId }));
      expect(messages).toHaveLength(count);
      expect(
        messages.every((message) => message.messageId && message.subject),
      ).toBe(true);
    },
  );

  it("returns concrete senders, timestamps, snippets and full exact-ID reads", async () => {
    const messages = rows(await list());
    expect(messages[0]).toMatchObject({
      sender: "Hannah Weber <hannah.weber@example.invalid>",
      subject: "Launch brief: headline approval today",
      messageTimestamp: "2026-11-14T11:55:00.000Z",
      labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
    });
    const result = await execute(binding, "gmail", gmail.tools.getMessage!, {
      message_id: messages[0].messageId,
      format: "full",
    });
    expect(result).toEqual({ message: messages[0] });
    expect((result.message as Record<string, unknown>).messageText).toContain(
      "Robin",
    );
  });

  it("filters Gmail participants, quoted subjects, unread state and exclusions", async () => {
    expect(
      rows(
        await list({
          query:
            'from:hannah.weber@example.invalid subject:"headline approval" is:unread',
        }),
      ),
    ).toHaveLength(1);
    expect(
      rows(
        await list({ query: "from:hannah.weber@example.invalid -is:unread" }),
      ),
    ).toEqual([]);
    expect(
      rows(
        await list({
          query:
            "{from:hannah.weber@example.invalid from:alex.kim@example.invalid} -filename:ics",
        }),
      ),
    ).toHaveLength(2);
    expect(
      rows(
        await list({
          query:
            "from:hannah.weber@example.invalid OR from:alex.kim@example.invalid",
        }),
      ),
    ).toHaveLength(2);
    expect(
      rows(
        await list({
          query:
            "(from:hannah.weber@example.invalid OR from:alex.kim@example.invalid) is:unread",
        }),
      ),
    ).toHaveLength(1);
    expect(
      rows(
        await list({
          query: "to:evals+lane1@sokosumi.com in:inbox -category:promotions",
        }),
      ),
    ).toHaveLength(4);
    expect(rows(await list({ query: "has:attachment" }))).toEqual([]);
  });

  it("applies epoch, calendar-date and relative date boundaries", async () => {
    const since = Date.parse("2026-11-14T11:30:00.000Z") / 1_000;
    const until = Date.parse("2026-11-14T11:55:00.000Z") / 1_000;
    expect(
      rows(await list({ query: `after:${since} before:${until}` })).map(
        (message) => message.subject,
      ),
    ).toEqual(["Launch briefing agenda"]);
    expect(
      rows(
        await list({
          query: "after:2026/11/14 before:2026/11/15 newer_than:1d",
        }),
      ),
    ).toHaveLength(6);
    expect(rows(await list({ query: "older_than:1d" }))).toEqual([]);
  });

  it("keeps sent-mail reads separate from inbox reads", async () => {
    const messages = rows(await list({ query: "in:sent" }));
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe("Robin Keller <evals+lane1@sokosumi.com>");
    expect(
      rows(
        await list({ query: "in:sent from:me to:alex.kim@example.invalid" }),
      ),
    ).toEqual(messages);
    expect(rows(await list({ query: "in:inbox from:me" }))).toEqual([]);
    expect(
      rows(await list({ query: "from:evals+lane1@sokosumi.com" })),
    ).toEqual(messages);
  });

  it("keeps the fixture date-only boundary distinct from an absolute epoch", async () => {
    const fixture = { ...binding, referenceTime: "2026-11-14T08:05:00.000Z" };
    expect(
      rows(await list({ query: "after:2026/11/14" }, fixture)),
    ).toHaveLength(1);
    expect(
      rows(
        await list(
          { query: `after:${Date.parse("2026-11-14T00:00:00Z") / 1_000}` },
          fixture,
        ),
      ),
    ).toHaveLength(6);
    expect(
      rows(await list({ query: "before:2026/11/14" }, fixture)),
    ).toHaveLength(5);
  });

  it("does not share mutable message data between calls", async () => {
    const first = rows(await list());
    first[0].subject = "Changed by another caller";
    (first[0].labelIds as string[]).push("MUTATED");
    expect(rows(await list())[0]).toMatchObject({
      subject: "Launch brief: headline approval today",
      labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
    });
  });

  it("uses the documented PST fixture boundary without inferring summer DST", async () => {
    const fixture = { ...binding, referenceTime: "2026-07-14T08:05:00.000Z" };
    expect(
      rows(await list({ query: "after:2026/07/14" }, fixture)),
    ).toHaveLength(1);
  });

  it("returns non-overlapping stable pages bound to the result and query", async () => {
    const first = await list({ max_results: 2 });
    const second = await list({
      max_results: 2,
      page_token: first.nextPageToken,
    });
    const third = await list({
      max_results: 2,
      page_token: second.nextPageToken,
    });
    expect(rows(first)).toHaveLength(2);
    expect(rows(second)).toHaveLength(2);
    expect(rows(third)).toHaveLength(2);
    expect(third.nextPageToken).toBeUndefined();
    const ids = [...rows(first), ...rows(second), ...rows(third)].map(
      (message) => message.messageId,
    );
    expect(new Set(ids).size).toBe(6);
    expect(await list({ max_results: 2 })).toEqual(first);
    await expect(
      list({
        query: "is:unread",
        max_results: 2,
        page_token: first.nextPageToken,
      }),
    ).rejects.toThrow(/page token/i);
    await expect(
      list(
        { max_results: 2, page_token: first.nextPageToken },
        { ...binding, resultId: "different-result" },
      ),
    ).rejects.toThrow(/page token/i);
  });

  it("rejects a message ID from another result", async () => {
    const id = rows(await list())[0].messageId;
    await expect(
      execute(
        { ...binding, resultId: "another-result" },
        "gmail",
        gmail.tools.getMessage!,
        { message_id: id },
      ),
    ).rejects.toThrow(/message/i);
  });

  it.each(["quiet-standup", "quiet-delta"] as const)(
    "gives %s only automated mail and no events",
    async (caseId) => {
      const fixture = { ...binding, caseId };
      const messages = rows(await list({}, fixture));
      expect(messages.map((message) => message.subject)).toEqual([
        "Weekly product newsletter",
        "Payment receipt",
        "Build notification: checks passed",
      ]);
      expect(rows(await events(fixture), "items")).toEqual([]);
    },
  );

  it("places tomorrow's owned and guest meetings in the Berlin calendar day", async () => {
    const result = rows(
      await events({ ...binding, caseId: "calendar-prep" }),
      "items",
    );
    expect(result.map((event) => event.start)).toEqual([
      { dateTime: "2026-11-15T09:00:00.000Z", timeZone: "Europe/Berlin" },
      { dateTime: "2026-11-15T14:00:00.000Z", timeZone: "Europe/Berlin" },
    ]);
    expect(result[0].organizer).toEqual({
      email: "evals+lane1@sokosumi.com",
      self: true,
    });
    expect(result[0].description).toContain("Robin Keller owns the agenda");
    expect(result[1].organizer).toEqual({
      email: "nina@example.invalid",
      self: false,
    });
  });

  it.each([
    ["2026-03-28T12:00:00.000Z", "2026-03-29T08:00:00.000Z"],
    ["2026-10-24T12:00:00.000Z", "2026-10-25T09:00:00.000Z"],
  ])(
    "uses Berlin's tomorrow across clock changes from %s",
    async (referenceTime, expected) => {
      const result = await events(
        { ...binding, caseId: "calendar-prep", referenceTime },
        { timeMin: "2026-01-01T00:00:00Z", timeMax: "2027-01-01T00:00:00Z" },
      );
      expect(rows(result, "items")[0].start).toMatchObject({
        dateTime: expected,
      });
    },
  );

  it("provides one upcoming owned meeting with a concrete preparation agenda", async () => {
    const result = rows(
      await events({ ...binding, caseId: "autonomous-meeting-prep" }),
      "items",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      summary: "Launch decision meeting",
      start: { dateTime: "2026-11-14T14:00:00.000Z" },
      organizer: { email: "evals+lane1@sokosumi.com", self: true },
    });
    expect(result[0].description).toContain("competitor pricing");
  });

  it("filters and pages calendar events with half-open overlapping windows", async () => {
    const fixture: MailboxFixtureBinding = {
      ...binding,
      caseId: "calendar-prep",
    };
    const first = await events(fixture, { max_results: 1 });
    const second = await events(fixture, {
      max_results: 1,
      page_token: first.nextPageToken,
    });
    expect(rows(first, "items")).toHaveLength(1);
    expect(rows(second, "items")).toHaveLength(1);
    expect(rows(first, "items")[0].id).not.toBe(rows(second, "items")[0].id);
    expect(second.nextPageToken).toBeUndefined();
    expect(
      rows(
        await events(fixture, {
          timeMin: "2026-11-15T09:30:00Z",
          timeMax: "2026-11-15T10:00:00Z",
        }),
        "items",
      ),
    ).toHaveLength(1);
    expect(
      rows(
        await events(fixture, {
          timeMin: "2026-11-15T10:00:00Z",
          timeMax: "2026-11-15T14:00:00Z",
        }),
        "items",
      ),
    ).toEqual([]);
    await expect(
      events(
        { ...fixture, resultId: "other" },
        { max_results: 1, page_token: first.nextPageToken },
      ),
    ).rejects.toThrow(/page token/i);
  });

  it.each([
    "unknown:value",
    "has:drive",
    "is:snoozed",
    "after:yesterday",
    'subject:"unclosed',
    "{from:alex@example.invalid",
    "from:alex@example.invalid OR",
  ])("refuses unsupported or malformed query %s", async (query) => {
    await expect(list({ query })).rejects.toThrow();
  });

  it.each([
    ["gmail", "GMAIL_SEND_DRAFT"],
    ["gmail", "GMAIL_CREATE_EMAIL_DRAFT"],
    ["gmail", "GMAIL_BATCH_MODIFY_MESSAGES"],
    ["gmail", "GMAIL_GET_ATTACHMENT"],
    ["googlecalendar", "GOOGLECALENDAR_CREATE_EVENT"],
    ["outlook", "OUTLOOK_OUTLOOK_LIST_MESSAGES"],
  ])("rejects %s operation %s", async (provider, slug) => {
    await expect(execute(binding, provider, slug, {})).rejects.toThrow(
      /unsupported/i,
    );
  });

  it("rejects unknown cases, invalid dates, unused arguments and invalid page sizes", async () => {
    await expect(
      list({}, {
        ...binding,
        caseId: "not-a-mail-case",
      } as unknown as MailboxFixtureBinding),
    ).rejects.toThrow(/case/i);
    await expect(
      list({}, { ...binding, referenceTime: "not-a-date" }),
    ).rejects.toThrow();
    await expect(list({ unexpected: true })).rejects.toThrow();
    await expect(list({ max_results: 0 })).rejects.toThrow();
    await expect(list({ page_token: "" })).rejects.toThrow();
    await expect(
      events(binding, {
        timeMin: "2026-11-16T00:00:00Z",
        timeMax: "2026-11-15T00:00:00Z",
      }),
    ).rejects.toThrow();
  });
});
