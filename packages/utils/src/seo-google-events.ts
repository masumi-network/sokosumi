/**
 * Google ranking updates, Search issues and Search Console data anomalies, for the bands on the SEO charts.
 *
 * Copied from the SEO bot's table `agent/lib/google-events.ts` (repository masumi-network/seo-bot), which is the
 * source: add rows there first, then copy them here with its GOOGLE_EVENTS_AS_OF. Days after that date are not
 * covered, so a chart says how far the table goes. Source ids (N3-153, G6-044, ...) name the stored copies of the
 * Search Status Dashboard and the Data anomalies page in the bot's research notes.
 */

/** The day the bot's stored copies of the dashboard and the Data anomalies page were fetched. */
export const GOOGLE_EVENTS_AS_OF = "2026-11-13";

export type GoogleEventKind =
  | "core update"
  | "spam update"
  | "ranking issue"
  | "serving issue"
  | "data anomaly"
  | "search change";

export interface GoogleEvent {
  name: string;
  kind: GoogleEventKind;
  /** First and last day; last null: a lasting change from its first day. */
  first: string;
  last: string | null;
  /** What the event moves. */
  touches: string;
  /** Whether it can move clicks. */
  clicks: boolean;
  /** The pages it touches, when not every page. */
  scope?: string;
  /** Still rolling out on the as-of day: last is that day, not the real end. */
  open?: true;
  sources: string[];
}

const RANKING = "rankings in Google Search, so clicks and impressions";
const SERVING = "serving of Google Search, so clicks and impressions";
const update = (
  name: string,
  first: string,
  last: string,
  sources: string[],
): GoogleEvent => ({
  name,
  kind: name.includes("core") ? "core update" : "spam update",
  first,
  last,
  touches: RANKING,
  clicks: true,
  sources,
});

export const GOOGLE_EVENTS: readonly GoogleEvent[] = [
  update("March 2024 core update", "2024-03-05", "2024-04-19", ["N3-153"]),
  update("March 2024 spam update", "2024-03-05", "2024-03-20", ["N3-154"]),
  update("June 2024 spam update", "2024-06-20", "2024-06-28", ["N3-154"]),
  update("August 2024 core update", "2024-08-15", "2024-09-04", ["N3-153"]),
  {
    name: "Ranking is experiencing an ongoing issue",
    kind: "ranking issue",
    first: "2024-08-15",
    last: "2024-08-20",
    touches: RANKING,
    clicks: true,
    sources: ["GB-020"],
  },
  update("November 2024 core update", "2024-11-11", "2024-12-05", ["N3-153"]),
  update("December 2024 core update", "2024-12-12", "2024-12-19", ["N3-153"]),
  update("December 2024 spam update", "2024-12-19", "2024-12-27", ["N3-154"]),
  update("March 2025 core update", "2025-03-13", "2025-03-27", ["N3-155"]),
  update("June 2025 core update", "2025-06-30", "2025-07-17", ["N3-155"]),
  update("August 2025 spam update", "2025-08-26", "2025-09-22", ["N3-156"]),
  {
    name: "Serving was experiencing an ongoing issue",
    kind: "serving issue",
    first: "2025-10-03",
    last: "2025-10-06",
    touches: SERVING,
    clicks: true,
    sources: ["GB-022"],
  },
  update("December 2025 core update", "2025-12-11", "2025-12-29", [
    "G6-044",
    "N3-155",
  ]),
  {
    name: "Serving was experiencing an issue (15 minutes)",
    kind: "serving issue",
    first: "2026-02-25",
    last: "2026-02-25",
    touches: SERVING,
    clicks: true,
    sources: ["GB-022"],
  },
  update("March 2026 spam update", "2026-03-24", "2026-03-25", ["G6-044"]),
  update("March 2026 core update", "2026-03-27", "2026-04-08", ["G6-044"]),
  update("May 2026 core update", "2026-05-21", "2026-06-02", ["G6-044"]),
  update("June 2026 spam update", "2026-06-24", "2026-06-26", ["G6-044"]),
  update("August 2026 spam update", "2026-08-18", "2026-08-21", ["G6-044"]),
  update("September 2026 spam update", "2026-09-24", "2026-10-08", ["GB-035"]),
  // The core update had no end on the as-of day: its row ends on that day and is open, so a chart runs its band
  // past that day, at most by the longest finished rollout in this table. The next copy sets the real end.
  {
    ...update("November 2026 core update", "2026-11-10", GOOGLE_EVENTS_AS_OF, [
      "GB-035",
    ]),
    open: true,
  },
  {
    name: "Impressions logging error",
    kind: "data anomaly",
    first: "2025-05-13",
    last: "2026-04-27",
    touches: "impressions, CTR and average position; clicks were not affected",
    clicks: false,
    sources: ["G6-020"],
  },
  {
    name: "Job listing and Job details logging error",
    kind: "data anomaly",
    first: "2026-04-16",
    last: "2026-04-27",
    touches:
      "clicks and impressions of the Job listing and Job details search appearances",
    clicks: true,
    scope: "pages with JobPosting markup",
    sources: ["GB-021"],
  },
  {
    name: "FAQ rich results no longer shown",
    kind: "search change",
    first: "2026-05-07",
    last: null,
    touches:
      "FAQ rich results in Google Search, so the impressions and clicks a page got from them",
    clicks: true,
    scope: "pages with FAQPage markup",
    sources: ["G6-021"],
  },
];
