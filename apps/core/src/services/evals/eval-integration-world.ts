import { createHash } from "node:crypto";
import { EVAL_CONNECTED_ACCOUNT_PREFIX } from "@/lib/evals/eval-social-account";

/**
 * The connected accounts an eval lane's bots have: Gmail, Google Calendar,
 * Drive, Sheets, GitHub and Notion, answered from fixed data. Nothing here
 * reaches Composio. A read returns the same data every run; a write (a
 * draft, a sent mail, a new issue) answers that it worked and changes
 * nothing anywhere. A tool the world does not have is refused, never
 * passed through.
 */

export const EVAL_INTEGRATION_PROVIDERS = [
  "gmail",
  "googlecalendar",
  "googledrive",
  "googlesheets",
  "github",
  "notion",
  "google_search_console",
  "google_analytics",
] as const;

/** The account id an eval lane's integration carries: never a Composio one. */
export function evalIntegrationAccountId(lane: string, provider: string) {
  return `${EVAL_CONNECTED_ACCOUNT_PREFIX}${lane}:${provider}`;
}

export function isEvalIntegrationAccount(composioAccountId: string): boolean {
  return composioAccountId.startsWith(EVAL_CONNECTED_ACCOUNT_PREFIX);
}

type Args = Record<string, unknown>;

interface EvalTool {
  slug: string;
  name: string;
  description: string;
  readOnly: boolean;
  run: (args: Args) => Record<string, unknown>;
}

/** A stable id from what was asked, so a rerun gets the same id. */
function stableId(prefix: string, args: Args): string {
  const hash = createHash("sha1")
    .update(JSON.stringify(args, Object.keys(args).sort()))
    .digest("hex")
    .slice(0, 10);
  return `${prefix}-${hash}`;
}

const INBOX = [
  {
    messageId: "eval-mail-1",
    threadId: "eval-thread-1",
    sender: "Lena Hoffmann <lena@brightdesk.example>",
    to: "owner@padierfind.example",
    subject: "Question about your team plan",
    messageText:
      "Hi, we are five people and want to try Padierfind for our client work. Is there a team plan, and can we pay yearly? Thanks, Lena",
    messageTimestamp: "2026-11-24T08:12:00.000Z",
    labelIds: ["INBOX", "UNREAD"],
  },
  {
    messageId: "eval-mail-2",
    threadId: "eval-thread-2",
    sender: "Jonas Aalto <jonas@fjordline.example>",
    to: "owner@padierfind.example",
    subject: "Intro call next week?",
    messageText:
      "Great to meet you at the AI agents meetup. Would Tuesday or Wednesday next week work for a 30-minute intro call? Jonas, Fjordline Capital",
    messageTimestamp: "2026-11-23T15:40:00.000Z",
    labelIds: ["INBOX", "UNREAD"],
  },
  {
    messageId: "eval-mail-3",
    threadId: "eval-thread-3",
    sender: "Billing <billing@cloudhost.example>",
    to: "owner@padierfind.example",
    subject: "Your November invoice: EUR 49.00",
    messageText:
      "Your invoice for November is ready: EUR 49.00 for the Starter plan, paid by card on 1 December.",
    messageTimestamp: "2026-11-22T06:00:00.000Z",
    labelIds: ["INBOX"],
  },
] as const;

/** Gmail's own operators, which the fixed inbox does not filter on. */
const GMAIL_OPERATOR = /^-?[a-z_]+:/i;

/** Seconds since the epoch a Gmail `after:`/`before:` operator names. */
function epochBound(text: string, operator: "after" | "before") {
  const value = text.match(new RegExp(`\\b${operator}:(\\d+)\\b`))?.[1];
  return value ? Number(value) * 1000 : null;
}

/**
 * The fixed inbox as Gmail would filter it: words in the sender, subject or
 * body; `is:unread`; `after:`/`before:` in epoch seconds (what Core sends);
 * nothing in `in:sent`. Other operators do not narrow it.
 */
function matchingMail(query: unknown) {
  const text = typeof query === "string" ? query : "";
  if (/\bin:sent\b/.test(text)) return [];
  const unreadOnly = /\bis:unread\b/.test(text);
  const after = epochBound(text, "after");
  const before = epochBound(text, "before");
  const words = text
    .split(/\s+/)
    .filter((word) => word && !GMAIL_OPERATOR.test(word))
    .map((word) => word.toLowerCase());
  return INBOX.filter((mail) => {
    const at = Date.parse(mail.messageTimestamp);
    return (
      (!unreadOnly ||
        (mail.labelIds as readonly string[]).includes("UNREAD")) &&
      (after === null || at > after) &&
      (before === null || at < before) &&
      words.every((word) =>
        `${mail.sender} ${mail.subject} ${mail.messageText}`
          .toLowerCase()
          .includes(word),
      )
    );
  });
}

/**
 * The owner's week, fixed by weekday (UTC, Monday = 1): a meeting is on the
 * same date and hour whatever window asks for it, so a meeting found in a
 * week is also found when its exact hour is asked for.
 */
const WEEKLY_EVENTS = [
  { id: "standup", summary: "Team stand-up", weekday: 1, hour: 8, hours: 1 },
  {
    id: "intro",
    summary: "Intro call: Fjordline Capital",
    weekday: 2,
    hour: 13,
    hours: 1,
  },
  {
    id: "workshop",
    summary: "Customer workshop: Brightdesk",
    weekday: 3,
    hour: 9,
    hours: 3,
  },
] as const;

/** Longest window answered, so a year's query stays a short page. */
const CALENDAR_MAX_DAYS = 62;

/** Every weekly event that overlaps [timeMin, timeMax), in start order. */
function calendarEvents(args: Args) {
  const timeMin = Date.parse(
    typeof args.timeMin === "string" ? args.timeMin : "2026-11-30T00:00:00Z",
  );
  const timeMax =
    typeof args.timeMax === "string"
      ? Date.parse(args.timeMax)
      : timeMin + 7 * 86_400_000;
  const day = new Date(timeMin);
  // From the start of the day before, so an event already running counts.
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - 1);
  const events = [];
  for (let n = 0; n < CALENDAR_MAX_DAYS && day.getTime() < timeMax; n++) {
    for (const event of WEEKLY_EVENTS) {
      if (day.getUTCDay() !== event.weekday) continue;
      const start = new Date(day);
      start.setUTCHours(event.hour);
      const end = new Date(start);
      end.setUTCHours(event.hour + event.hours);
      if (end.getTime() <= timeMin || start.getTime() >= timeMax) continue;
      events.push({
        id: `eval-event-${event.id}-${start.toISOString().slice(0, 10)}`,
        summary: event.summary,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        attendees: [
          { email: "owner@padierfind.example", responseStatus: "accepted" },
        ],
      });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return events;
}

const TOOLS: Record<string, readonly EvalTool[]> = {
  gmail: [
    {
      slug: "GMAIL_FETCH_EMAILS",
      name: "Fetch emails",
      description: "List messages in the mailbox, newest first.",
      readOnly: true,
      run: (args) => ({
        messages: matchingMail(args.query),
        nextPageToken: null,
      }),
    },
    {
      slug: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      name: "Fetch message by id",
      description: "Read one message in full.",
      readOnly: true,
      run: (args) => {
        const mail = INBOX.find((item) => item.messageId === args.message_id);
        if (!mail) throw new Error(`No message ${String(args.message_id)}`);
        return { ...mail };
      },
    },
    {
      slug: "GMAIL_CREATE_EMAIL_DRAFT",
      name: "Create email draft",
      description: "Save a draft in the mailbox. Nothing is sent.",
      readOnly: false,
      run: (args) => ({ draft_id: stableId("eval-draft", args) }),
    },
    {
      slug: "GMAIL_SEND_DRAFT",
      name: "Send draft",
      description: "Send a saved draft.",
      readOnly: false,
      // Answers like a send; nothing leaves the eval world.
      run: (args) => ({ id: stableId("eval-sent", args), labelIds: ["SENT"] }),
    },
  ],
  googlecalendar: [
    {
      slug: "GOOGLECALENDAR_EVENTS_LIST",
      name: "List events",
      description: "Events on the primary calendar in a time window.",
      readOnly: true,
      // Only events that overlap the window asked for, as Google returns.
      run: (args) => ({ items: calendarEvents(args), nextPageToken: null }),
    },
    {
      slug: "GOOGLECALENDAR_CREATE_EVENT",
      name: "Create event",
      description: "Add an event to the primary calendar.",
      readOnly: false,
      run: (args) => ({
        id: stableId("eval-event", args),
        status: "confirmed",
      }),
    },
  ],
  googledrive: [
    {
      slug: "GOOGLEDRIVE_FIND_FILE",
      name: "Find file",
      description: "Search the Drive for files by name.",
      readOnly: true,
      run: () => ({
        files: [
          {
            id: "eval-drive-1",
            name: "Q4 plan.docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
          {
            id: "eval-drive-2",
            name: "Customer list.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ],
      }),
    },
  ],
  googlesheets: [
    {
      slug: "GOOGLESHEETS_BATCH_GET",
      name: "Read ranges",
      description: "Read cell values from a spreadsheet.",
      readOnly: true,
      run: () => ({
        valueRanges: [
          {
            range: "Sheet1!A1:C4",
            values: [
              ["Customer", "Plan", "Monthly (EUR)"],
              ["Brightdesk", "Team", "150"],
              ["Northwind Studio", "Starter", "49"],
              ["Kestrel Labs", "Team", "150"],
            ],
          },
        ],
      }),
    },
    {
      slug: "GOOGLESHEETS_BATCH_UPDATE",
      name: "Write ranges",
      description: "Write cell values to a spreadsheet.",
      readOnly: false,
      run: (args) => ({
        updatedRange: String(args.range ?? "Sheet1"),
        updatedCells: 0,
      }),
    },
  ],
  github: [
    {
      slug: "GITHUB_LIST_PULL_REQUESTS",
      name: "List pull requests",
      description: "Pull requests of a repository.",
      readOnly: true,
      run: () => ({
        pull_requests: [
          {
            number: 42,
            title: "Add yearly billing",
            state: "open",
            user: { login: "codepat" },
          },
          {
            number: 41,
            title: "Fix the signup email",
            state: "closed",
            merged_at: "2026-11-25T10:00:00Z",
            user: { login: "codepat" },
          },
        ],
      }),
    },
    {
      slug: "GITHUB_CREATE_AN_ISSUE",
      name: "Create an issue",
      description: "Open an issue in a repository.",
      readOnly: false,
      run: (args) => ({
        number: 100,
        html_url: `https://github.invalid/issues/${stableId("eval-issue", args)}`,
      }),
    },
  ],
  notion: [
    {
      slug: "NOTION_SEARCH_NOTION_PAGE",
      name: "Search pages",
      description: "Find pages in the workspace by title.",
      readOnly: true,
      run: () => ({
        results: [
          { id: "eval-notion-1", title: "Launch checklist" },
          { id: "eval-notion-2", title: "Customer interview notes" },
        ],
      }),
    },
    {
      slug: "NOTION_CREATE_NOTION_PAGE",
      name: "Create page",
      description: "Create a page in the workspace.",
      readOnly: false,
      run: (args) => ({ id: stableId("eval-notion", args) }),
    },
  ],
};

/** Each day from start to end (inclusive), capped so a year is not 366 rows. */
function daysBetween(start: unknown, end: unknown, cap = 31): string[] {
  const from = new Date(`${String(start ?? "2026-11-01")}T00:00:00Z`);
  const to = new Date(`${String(end ?? "2026-11-07")}T00:00:00Z`);
  const days: string[] = [];
  for (
    const at = new Date(from);
    at <= to && days.length < cap;
    at.setUTCDate(at.getUTCDate() + 1)
  )
    days.push(at.toISOString().slice(0, 10));
  return days;
}

const SEARCH_QUERIES = [
  ["padierfind", 210, 1900, 1.4],
  ["ai agent marketplace europe", 64, 2400, 8.2],
  ["hire ai agents for marketing", 41, 1800, 11.6],
  ["padierfind pricing", 38, 420, 2.1],
  ["seed investors ai agents", 12, 950, 18.3],
] as const;

function gscRows(args: Args) {
  const dimensions = Array.isArray(args.dimensions) ? args.dimensions : [];
  const row = (
    keys: string[],
    clicks: number,
    impressions: number,
    position: number,
  ) => ({
    keys,
    clicks,
    impressions,
    ctr: Number((clicks / impressions).toFixed(4)),
    position,
  });
  if (dimensions.includes("date"))
    return daysBetween(args.start_date, args.end_date).map((day, index) =>
      row([day], 40 + (index % 7) * 3, 1100 + (index % 7) * 60, 9.5),
    );
  if (dimensions.includes("query"))
    return SEARCH_QUERIES.map(([query, clicks, impressions, position]) =>
      row([query], clicks, impressions, position),
    );
  if (dimensions.includes("page"))
    return [
      row(["https://padierfind.com/"], 240, 3100, 3.2),
      row(["https://padierfind.com/pricing"], 61, 900, 5.8),
      row(["https://padierfind.com/blog/ai-agents"], 54, 2700, 12.4),
    ];
  return [row([], 365, 7470, 9.4)];
}

/** One GA4 row per day when the report asks for dates, else the period. */
function ga4Report(args: Args) {
  const metrics = (Array.isArray(args.metrics) ? args.metrics : []).map(
    (metric) => String((metric as { name?: unknown })?.name ?? metric),
  );
  const dimensions = (
    Array.isArray(args.dimensions) ? args.dimensions : []
  ).map((dimension) =>
    String((dimension as { name?: unknown })?.name ?? dimension),
  );
  const range = (
    Array.isArray(args.dateRanges) ? args.dateRanges[0] : null
  ) as {
    startDate?: string;
    endDate?: string;
  } | null;
  const value = (metric: number, day: number) =>
    String(120 + metric * 35 + (day % 7) * 11);
  const rows = dimensions.includes("date")
    ? daysBetween(range?.startDate, range?.endDate).map((day, index) => ({
        dimensionValues: [{ value: day.replaceAll("-", "") }],
        metricValues: metrics.map((_, metric) => ({
          value: value(metric, index),
        })),
      }))
    : [
        {
          dimensionValues: [],
          metricValues: metrics.map((_, metric) => ({
            value: value(metric, 0),
          })),
        },
      ];
  return {
    dimensionHeaders: dimensions.map((name) => ({ name })),
    metricHeaders: metrics.map((name) => ({ name })),
    rows,
    rowCount: rows.length,
  };
}

const VIDEO = {
  id: "omM89sE7Jpg",
  snippet: {
    title: "Routing forms: send every lead to the right person (Cal.com)",
    description:
      "A 6-minute walkthrough of routing forms: ask two or three questions before a booking, then send each lead to the right teammate's calendar.",
    publishedAt: "2026-11-20T09:00:00Z",
  },
  statistics: { viewCount: "1840", likeCount: "96", commentCount: "14" },
};

Object.assign(TOOLS, {
  google_search_console: [
    {
      slug: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
      name: "List sites",
      description: "Search Console properties of the account.",
      readOnly: true,
      run: () => ({
        siteEntry: [
          { siteUrl: "sc-domain:padierfind.com", permissionLevel: "siteOwner" },
        ],
      }),
    },
    {
      slug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
      name: "Search analytics query",
      description:
        "Clicks, impressions, CTR and position by query, page or date.",
      readOnly: true,
      run: (args) => ({
        rows: gscRows(args),
        responseAggregationType: "byProperty",
      }),
    },
    {
      slug: "GOOGLE_SEARCH_CONSOLE_INSPECT_URL",
      name: "Inspect URL",
      description: "Whether Google has indexed a page.",
      readOnly: true,
      run: () => ({
        inspectionResult: {
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
          },
        },
      }),
    },
    {
      slug: "GOOGLE_SEARCH_CONSOLE_LIST_SITEMAPS",
      name: "List sitemaps",
      description: "Sitemaps submitted for the property.",
      readOnly: true,
      run: () => ({
        sitemap: [
          {
            path: "https://padierfind.com/sitemap.xml",
            errors: "0",
            warnings: "0",
          },
        ],
      }),
    },
  ],
  google_analytics: [
    {
      slug: "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES",
      name: "List account summaries",
      description: "GA4 accounts and their properties.",
      readOnly: true,
      run: () => ({
        accountSummaries: [
          {
            account: "accounts/100001",
            displayName: "Padierfind",
            propertySummaries: [
              { property: "properties/200001", displayName: "padierfind.com" },
            ],
          },
        ],
      }),
    },
    {
      slug: "GOOGLE_ANALYTICS_RUN_REPORT",
      name: "Run report",
      description:
        "A GA4 report: metrics over a date range, optionally by day.",
      readOnly: true,
      run: ga4Report,
    },
  ],
  youtube: [
    {
      slug: "YOUTUBE_LIST_CHANNELS",
      name: "List channels",
      description: "The account's YouTube channel.",
      readOnly: true,
      run: () => ({
        items: [
          {
            id: "UCevalPadierfind",
            snippet: { title: "Padierfind" },
            statistics: {
              subscriberCount: "312",
              videoCount: "9",
              viewCount: "15400",
            },
          },
        ],
      }),
    },
    {
      slug: "YOUTUBE_LIST_CHANNEL_VIDEOS",
      name: "List channel videos",
      description: "Recent videos on the channel.",
      readOnly: true,
      run: () => ({
        items: [{ id: { videoId: VIDEO.id }, snippet: VIDEO.snippet }],
      }),
    },
    {
      slug: "YOUTUBE_GET_VIDEO_DETAILS_BATCH",
      name: "Get video details",
      description: "Title, description and statistics of videos.",
      readOnly: true,
      run: () => ({ items: [VIDEO] }),
    },
    {
      slug: "YOUTUBE_QUERY_ANALYTICS",
      name: "Query analytics",
      description: "Views and watch time over a date range.",
      readOnly: true,
      run: (args) => ({
        columnHeaders: [
          { name: "day" },
          { name: "views" },
          { name: "estimatedMinutesWatched" },
        ],
        rows: daysBetween(args.startDate, args.endDate).map((day, index) => [
          day,
          50 + (index % 7) * 4,
          210 + (index % 7) * 15,
        ]),
      }),
    },
    {
      slug: "YOUTUBE_LIST_COMMENT_THREADS2",
      name: "List comment threads",
      description: "Comments on a video.",
      readOnly: true,
      run: () => ({
        items: [
          {
            id: "eval-yt-comment-1",
            snippet: {
              videoId: VIDEO.id,
              topLevelComment: {
                snippet: {
                  authorDisplayName: "Mara L.",
                  textDisplay: "Does this work with round-robin teams too?",
                  publishedAt: "2026-11-21T10:00:00Z",
                },
              },
            },
          },
        ],
      }),
    },
  ],
} satisfies Record<string, readonly EvalTool[]>);

export class EvalWorldRefusal extends Error {}

function toolOf(provider: string, slug: string): EvalTool {
  const tool = TOOLS[provider]?.find((candidate) => candidate.slug === slug);
  if (!tool)
    throw new EvalWorldRefusal(
      `${slug} is not available on this connected account; use list_integration_tools to see what it has`,
    );
  return tool;
}

/** A Composio tool run, answered by the eval world. */
export function runEvalIntegrationTool(
  provider: string,
  slug: string,
  args: Args,
): Record<string, unknown> {
  return toolOf(provider, slug).run(args);
}

export function isEvalIntegrationToolReadOnly(provider: string, slug: string) {
  return toolOf(provider, slug).readOnly;
}

/** The account's tools, narrowed to those with any of the query's words. */
export function listEvalIntegrationTools(
  provider: string,
  options: { query?: string; limit: number },
) {
  const words = (options.query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);
  return (TOOLS[provider] ?? [])
    .filter(
      (tool) =>
        words.length === 0 ||
        words.some((word) =>
          `${tool.slug} ${tool.name} ${tool.description}`
            .toLowerCase()
            .includes(word),
        ),
    )
    .slice(0, options.limit)
    .map((tool) => ({
      slug: tool.slug,
      name: tool.name,
      description: tool.description,
      inputSchema: null,
      readOnly: tool.readOnly,
    }));
}
