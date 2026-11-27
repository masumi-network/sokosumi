import { describe, expect, it } from "vitest";
import {
  EvalWorldRefusal,
  evalIntegrationAccountId,
  isEvalIntegrationAccount,
  isEvalIntegrationToolReadOnly,
  listEvalIntegrationTools,
  runEvalIntegrationTool,
} from "./eval-integration-world";

describe("eval integration world", () => {
  it("marks its accounts so they never pass for Composio ones", () => {
    const id = evalIntegrationAccountId("lane-1", "gmail");
    expect(isEvalIntegrationAccount(id)).toBe(true);
    expect(isEvalIntegrationAccount("ca_live_123")).toBe(false);
  });

  it("lists the fixed inbox, filtered by words, unread and the date bounds", () => {
    const subjects = (query: string) =>
      (
        runEvalIntegrationTool("gmail", "GMAIL_FETCH_EMAILS", { query })
          .messages as { subject: string }[]
      ).map((mail) => mail.subject);
    expect(subjects("after:1700000000")).toHaveLength(3);
    // Codex: an unread-only query must not include the read invoice.
    expect(subjects("after:1700000000 is:unread")).toEqual([
      "Question about your team plan",
      "Intro call next week?",
    ]);
    // Codex: a date after every message finds none.
    expect(
      subjects(`after:${Date.parse("2026-12-01T00:00:00Z") / 1000}`),
    ).toEqual([]);
    expect(
      subjects(`before:${Date.parse("2026-11-23T00:00:00Z") / 1000}`),
    ).toEqual(["Your November invoice: EUR 49.00"]);
    const invoice = runEvalIntegrationTool("gmail", "GMAIL_FETCH_EMAILS", {
      query: "invoice after:1700000000",
    }).messages as { subject: string }[];
    expect(invoice.map((mail) => mail.subject)).toEqual([
      "Your November invoice: EUR 49.00",
    ]);
    expect(
      runEvalIntegrationTool("gmail", "GMAIL_FETCH_EMAILS", {
        query: "in:sent",
      }).messages,
    ).toEqual([]);
  });

  it("reads one message, and refuses an id it does not have", () => {
    expect(
      runEvalIntegrationTool("gmail", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
        message_id: "eval-mail-2",
      }),
    ).toMatchObject({ subject: "Intro call next week?" });
    expect(() =>
      runEvalIntegrationTool("gmail", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
        message_id: "nope",
      }),
    ).toThrow("No message nope");
  });

  it("answers a draft and a send like Gmail, with ids that repeat for the same input", () => {
    const draft = { recipient_email: "lena@brightdesk.example", subject: "Re" };
    const id = runEvalIntegrationTool(
      "gmail",
      "GMAIL_CREATE_EMAIL_DRAFT",
      draft,
    );
    expect(id).toEqual(
      runEvalIntegrationTool("gmail", "GMAIL_CREATE_EMAIL_DRAFT", draft),
    );
    expect(
      runEvalIntegrationTool("gmail", "GMAIL_SEND_DRAFT", { draft_id: "d-1" }),
    ).toMatchObject({ labelIds: ["SENT"] });
  });

  it("puts the calendar's events inside the window asked for", () => {
    const { items } = runEvalIntegrationTool(
      "googlecalendar",
      "GOOGLECALENDAR_EVENTS_LIST",
      {
        timeMin: "2026-12-07T00:00:00.000Z",
        timeMax: "2026-12-14T00:00:00.000Z",
      },
    ) as { items: { start: { dateTime: string } }[] };
    expect(items.map((event) => event.start.dateTime)).toEqual([
      "2026-12-07T08:00:00.000Z",
      "2026-12-08T13:00:00.000Z",
      "2026-12-09T09:00:00.000Z",
    ]);
  });

  it("returns only the events that overlap a short window (Codex)", () => {
    const events = (timeMin: string, timeMax: string) =>
      (
        runEvalIntegrationTool("googlecalendar", "GOOGLECALENDAR_EVENTS_LIST", {
          timeMin,
          timeMax,
        }).items as { summary: string }[]
      ).map((event) => event.summary);
    expect(
      events("2026-12-07T12:00:00.000Z", "2026-12-07T13:00:00.000Z"),
    ).toEqual([]);
    expect(
      events("2026-12-07T08:30:00.000Z", "2026-12-07T08:45:00.000Z"),
    ).toEqual(["Team stand-up"]);
  });

  it("refuses a tool the world does not have instead of passing it on", () => {
    expect(() =>
      runEvalIntegrationTool("github", "GITHUB_DELETE_A_REPOSITORY", {}),
    ).toThrow(EvalWorldRefusal);
    expect(() => isEvalIntegrationToolReadOnly("notion", "NOTION_X")).toThrow(
      EvalWorldRefusal,
    );
    expect(
      isEvalIntegrationToolReadOnly("github", "GITHUB_LIST_PULL_REQUESTS"),
    ).toBe(true);
    expect(
      isEvalIntegrationToolReadOnly("github", "GITHUB_CREATE_AN_ISSUE"),
    ).toBe(false);
  });

  it("answers Search Console by query, by day and for the whole period", () => {
    const byQuery = runEvalIntegrationTool(
      "google_search_console",
      "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
      { site_url: "sc-domain:padierfind.com", dimensions: ["query"] },
    ).rows as { keys: string[]; ctr: number }[];
    expect(byQuery[0]).toMatchObject({ keys: ["padierfind"], clicks: 210 });
    const byDay = runEvalIntegrationTool(
      "google_search_console",
      "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
      {
        start_date: "2026-11-01",
        end_date: "2026-11-07",
        dimensions: ["date"],
      },
    ).rows as { keys: string[] }[];
    expect(byDay.map((row) => row.keys[0])).toHaveLength(7);
    expect(
      runEvalIntegrationTool(
        "google_search_console",
        "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
        { dimensions: [] },
      ).rows,
    ).toEqual([
      { keys: [], clicks: 365, impressions: 7470, ctr: 0.0489, position: 9.4 },
    ]);
  });

  it("answers a GA4 report with one value per metric asked for", () => {
    const report = runEvalIntegrationTool(
      "google_analytics",
      "GOOGLE_ANALYTICS_RUN_REPORT",
      {
        property: "properties/200001",
        dateRanges: [{ startDate: "2026-11-01", endDate: "2026-11-03" }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      },
    ) as {
      rows: { dimensionValues: { value: string }[]; metricValues: unknown[] }[];
    };
    expect(report.rows.map((row) => row.dimensionValues[0]?.value)).toEqual([
      "20261101",
      "20261102",
      "20261103",
    ]);
    expect(report.rows.every((row) => row.metricValues.length === 2)).toBe(
      true,
    );
  });

  it("reads the owner's YouTube video", () => {
    expect(
      runEvalIntegrationTool("youtube", "YOUTUBE_GET_VIDEO_DETAILS_BATCH", {
        id: "omM89sE7Jpg",
      }),
    ).toMatchObject({
      items: [
        {
          id: "omM89sE7Jpg",
          snippet: { title: expect.stringContaining("Routing") },
        },
      ],
    });
  });

  it("lists an account's tools by any query word", () => {
    expect(
      listEvalIntegrationTools("github", {
        query: "pull requests",
        limit: 5,
      }).map((tool) => tool.slug),
    ).toEqual(["GITHUB_LIST_PULL_REQUESTS"]);
    expect(listEvalIntegrationTools("notion", { limit: 5 })).toHaveLength(2);
    expect(listEvalIntegrationTools("slack", { limit: 5 })).toEqual([]);
  });
});
