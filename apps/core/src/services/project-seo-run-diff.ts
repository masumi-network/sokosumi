import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import {
  SEO_RUN_DIFF_ITEMS,
  type SeoRunDiff,
} from "@/schemas/project-seo-run-diff.schema";

import {
  issueIdentity,
  SEO_ISSUE_SEVERITIES,
} from "./project-seo-check-identity";
import {
  seoCheckResults,
  seoRankMoves,
  seoRunMismatch,
} from "./project-seo-monitor-change";
import { normalizeSeoUrl } from "./project-seo-store";

/** One stored check of the selected pages with its parsed result. */
export interface SeoRunDiffSource {
  id: string;
  kind: string;
  observedAt: Date;
  pageIds: string[];
  payload: PublicSeoPayload;
}

type Issue = SeoRunDiff["new"][number];
type Selected = (pageUrl: string) => boolean;

const SEVERITY_ORDER: Issue["severity"][] = ["critical", "major", "minor"];

/**
 * The issue a row belongs to: `issueIdentity` without the device. Finding ids change with every check, and
 * `seoIssueKey` holds the id of its check, so neither names an issue in two checks. The device is left out as the
 * issue count leaves it out: one rule that fails on mobile and on desktop is one issue on that page.
 */
const issueKey = (
  payload: PublicSeoPayload,
  row: { pageUrl: string; rowId: string },
) => issueIdentity(payload, { ...row, device: null });

function issueStates(payload: PublicSeoPayload, selected: Selected) {
  const open = new Map<string, Issue>();
  for (const finding of payload.findings) {
    if (!SEO_ISSUE_SEVERITIES.has(finding.severity)) continue;
    if (!selected(finding.pageUrl)) continue;
    const severity = finding.severity as Issue["severity"];
    const key = issueKey(payload, finding);
    const known = open.get(key);
    open.set(
      key,
      known
        ? {
            ...known,
            device: known.device === finding.device ? known.device : null,
            severity:
              SEVERITY_ORDER.indexOf(severity) <
              SEVERITY_ORDER.indexOf(known.severity)
                ? severity
                : known.severity,
          }
        : {
            rowId: finding.rowId,
            title: finding.title,
            pageUrl: finding.pageUrl,
            device: finding.device,
            severity,
          },
    );
  }
  const passed = new Map<string, Set<string>>(),
    fired = new Map<string, Set<string>>();
  for (const check of seoCheckResults(payload).values()) {
    if (!selected(check.pageUrl)) continue;
    const devices = check.result === "pass" ? passed : fired;
    const key = issueKey(payload, check);
    devices.set(key, (devices.get(key) ?? new Set()).add(check.device));
  }
  return { open, passed, fired };
}

const bySeverity = (a: Issue, b: Issue) =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);

/**
 * What the later check changed against the earlier one, per issue of the selected pages. An issue is new only where
 * the earlier check passed its rule, and fixed only where the later check passed it on every device it failed on.
 */
export function compareSeoRuns(
  previous: Pick<SeoRunDiffSource, "observedAt" | "payload">,
  latest: Pick<SeoRunDiffSource, "observedAt" | "payload">,
  selected: Selected,
): Omit<SeoRunDiff, "numbers"> & { moves: SeoRunDiff["numbers"]["moves"] } {
  const reason = seoRunMismatch(previous.payload, latest.payload);
  const before = issueStates(previous.payload, selected),
    after = issueStates(latest.payload, selected);
  const added: Issue[] = [],
    fixed: Issue[] = [],
    stillOpen: Issue[] = [];
  let notCheckedAgain = 0,
    notCheckedBefore = 0;
  if (!reason) {
    for (const [key, issue] of after.open) {
      if (before.open.has(key)) stillOpen.push(issue);
      else if (before.passed.has(key)) added.push(issue);
      else notCheckedBefore += 1;
    }
    for (const [key, issue] of before.open) {
      if (after.open.has(key)) continue;
      const passed = after.passed.get(key);
      if (
        passed &&
        !after.fired.has(key) &&
        [...(before.fired.get(key) ?? [])].every((device) => passed.has(device))
      )
        fixed.push(issue);
      else notCheckedAgain += 1;
    }
  }
  const moves = reason
    ? []
    : seoRankMoves(previous.payload, latest.payload).filter((move) =>
        selected(move.pageUrl),
      );
  const list = (issues: Issue[]) =>
    issues.sort(bySeverity).slice(0, SEO_RUN_DIFF_ITEMS);
  return {
    from: previous.observedAt.toISOString(),
    to: latest.observedAt.toISOString(),
    comparable: !reason,
    ...(reason && { reason }),
    new: list(added),
    newCount: added.length,
    fixed: list(fixed),
    fixedCount: fixed.length,
    stillOpen: list(stillOpen),
    stillOpenCount: stillOpen.length,
    notCheckedAgain,
    notCheckedBefore,
    moves,
  };
}

/**
 * The check to compare with: the latest earlier check of the same kind that read every selected page, in the same
 * Market where one exists. Checks of two Markets that take turns each keep their own line.
 */
function seoRunDiffOf(
  run: SeoRunDiffSource,
  sources: SeoRunDiffSource[],
  selectedIds: ReadonlySet<string>,
  selected: Selected,
) {
  const earlier = sources
    .filter(
      (source) =>
        source.kind === run.kind && source.observedAt < run.observedAt,
    )
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  if (!earlier.length) return null;
  const readsAll = (source: SeoRunDiffSource) =>
    [...selectedIds].every((id) => source.pageIds.includes(id));
  const full = earlier.filter(readsAll);
  if (!readsAll(run) || !full.length)
    return {
      previous: earlier[0],
      diff: {
        ...compareSeoRuns(earlier[0], run, () => false),
        comparable: false,
        reason: "pages" as const,
        moves: [],
      },
    };
  const previous =
    full.find(
      (source) => seoRunMismatch(source.payload, run.payload) !== "market",
    ) ?? full[0];
  return { previous, diff: compareSeoRuns(previous, run, selected) };
}

/** Each check with what it changed against the earlier comparable check. The first check of a kind has none. */
export function withSeoRunDiffs<
  T extends { observationId: string; issues: number | null },
>(
  runs: T[],
  {
    sources,
    selectedIds,
    selectedUrls,
  }: {
    sources: SeoRunDiffSource[];
    selectedIds: ReadonlySet<string>;
    selectedUrls: ReadonlySet<string>;
  },
): Array<T & { runDiff?: SeoRunDiff }> {
  const selected: Selected = (url) => selectedUrls.has(normalizeSeoUrl(url));
  const issuesOf = new Map(runs.map((run) => [run.observationId, run.issues]));
  return runs.map((run) => {
    const source = sources.find((item) => item.id === run.observationId);
    const pair = source && seoRunDiffOf(source, sources, selectedIds, selected);
    if (!pair) return run;
    const { moves, ...lists } = pair.diff;
    return {
      ...run,
      runDiff: {
        ...lists,
        numbers: {
          issues: {
            from: issuesOf.get(pair.previous.id) ?? null,
            to: run.issues,
          },
          moves: moves.slice(0, SEO_RUN_DIFF_ITEMS),
          moveCount: moves.length,
        },
      },
    };
  });
}
