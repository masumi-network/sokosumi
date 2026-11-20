import { createHash } from "node:crypto";
import type { ConsoleExportSnapshot } from "@/schemas/seo-console-export.schema";

type ExportAction = {
  id: string;
  title: string;
  why: string;
  nextCheck: string;
  subject?: string;
};
const maxActions = 3;
const issueChecks = {
  discovered_not_indexed:
    "Check whether a crawlable internal page links to the URL, then inspect its current status.",
  crawled_not_indexed:
    "Compare the declared and Google-selected canonicals. Review whether another page covers the same content.",
  excluded_noindex:
    "Check the robots meta tag and X-Robots-Tag. Confirm whether the exclusion is intentional.",
  blocked_robots:
    "Check the robots.txt rule for this path and confirm the intended crawl policy.",
  not_found:
    "Check the HTTP response and update internal links if the destination moved.",
  redirect:
    "Follow the redirect and compare its destination with internal links and sitemap entries.",
  alternate_canonical:
    "Compare Google's selected canonical with the intended destination.",
} as const;

export function consoleExportActions(
  current: ConsoleExportSnapshot,
  previous: ConsoleExportSnapshot | null,
  older: ConsoleExportSnapshot | null,
  passed: ReadonlySet<string>,
) {
  const actions: ExportAction[] = [];
  function add(
    rule: string,
    title: string,
    why: string,
    nextCheck: string,
    subject?: string,
  ) {
    const id = createHash("sha256")
      .update(JSON.stringify([current.kind, current.reason, rule, subject]))
      .digest("hex")
      .slice(0, 20);
    actions.push({ id, title, why, nextCheck, ...(subject && { subject }) });
  }
  if (current.kind === "linked_pages") {
    const positive = current.rows.filter(
      (row) => (row.counts.incomingLinks ?? 0) > 0,
    );
    if (positive.length === 1) {
      const { key, counts } = positive[0];
      add(
        "one_target",
        "Check which pages receive external links",
        `In the ${current.date} export, only this target has a positive external link count (${counts.incomingLinks}).`,
        "Review its linking sites and check whether useful related pages are reachable through internal links.",
        key,
      );
    }
  }
  if (
    (current.kind === "internal_pages" || current.kind === "linked_pages") &&
    previous &&
    older
  ) {
    const metric =
      current.kind === "internal_pages" ? "internalLinks" : "incomingLinks";
    const prior = new Map(
      previous.rows.map((row) => [row.key, row.counts[metric]]),
    );
    const first = new Map(
      older.rows.map((row) => [row.key, row.counts[metric]]),
    );
    const declines = current.rows
      .filter((row) => {
        const a = first.get(row.key),
          b = prior.get(row.key),
          c = row.counts[metric];
        return (
          a !== undefined &&
          b !== undefined &&
          c !== undefined &&
          a > b &&
          b > c
        );
      })
      .sort(
        (a, b) =>
          first.get(b.key)! -
          b.counts[metric]! -
          (first.get(a.key)! - a.counts[metric]!),
      );
    if (declines.length) {
      const row = declines[0];
      add(
        "successive_decline",
        "Review a target with two lower link counts",
        `The same URL appears in three dated exports: ${first.get(row.key)} on ${older.date}, ${prior.get(row.key)} on ${previous.date}, and ${row.counts[metric]} on ${current.date}.`,
        current.kind === "internal_pages"
          ? "Check navigation and internal source pages for changed links to this destination."
          : "Review the linking sites and redirects for this target. Changes in Google's sample can affect the counts.",
        row.key,
      );
    }
  }
  if (current.kind === "linking_sites" && previous) {
    const previousSites = new Set(previous.rows.map((row) => row.key));
    const newSite = current.rows
      .filter((row) => !previousSites.has(row.key))
      .sort(
        (a, b) => (b.counts.linkingPages ?? 0) - (a.counts.linkingPages ?? 0),
      )[0];
    if (newSite)
      add(
        "new_sample_site",
        "Review a linking site newly present in this sample",
        `This domain appears in the ${current.date} export and does not appear in the ${previous.date} sample.`,
        "Inspect its linking pages and their destination URLs before deciding whether any follow-up is needed.",
        newSite.key,
      );
  }
  if (current.reason) {
    const unresolved = current.rows.filter((row) => !passed.has(row.key));
    if (unresolved.length) {
      const prior = new Set(previous?.rows.map((row) => row.key));
      const repeated = unresolved.find((row) => prior.has(row.key));
      const chosen = repeated ?? unresolved[0];
      add(
        "indexing_example",
        "Review a reported indexing example",
        repeated && previous
          ? `This URL appears under the same indexing reason in the ${previous.date} and ${current.date} example exports.`
          : `This URL appears in the ${current.date} Page indexing example export. The export records the issue at that time.`,
        issueChecks[current.reason],
        chosen.key,
      );
    }
  }
  if (
    current.kind === "anchor_text" &&
    current.rows.some((row) => row.key === "")
  ) {
    add(
      "empty_anchor",
      "Review links with empty text",
      `The ${current.date} anchor-text sample includes an empty entry.`,
      "Open the entry in Search Console. Check its source links for meaningful text or descriptive image alt text.",
    );
  }
  return actions.slice(0, maxActions);
}
