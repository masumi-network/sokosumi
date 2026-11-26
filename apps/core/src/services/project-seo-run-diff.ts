import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import {
  SEO_RUN_DIFF_ITEMS,
  type SeoRunDiff,
} from "@/schemas/project-seo-run-diff.schema";

import {
  issueIdentity,
  SEO_ISSUE_SEVERITIES,
} from "./project-seo-check-identity";
import { seoRankMoves, seoRunMismatch } from "./project-seo-monitor-change";
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

type Devices = Map<string, Set<string | null>>;
const addDevice = (devices: Devices, key: string, device: string | null) =>
  devices.set(key, (devices.get(key) ?? new Set()).add(device));

const stateCache = new WeakMap<
  Selected,
  WeakMap<PublicSeoPayload, ReturnType<typeof readIssueStates>>
>();
/** The states of one check, read once for each selection: a check is compared with its neighbour on both sides. */
function issueStates(payload: PublicSeoPayload, selected: Selected) {
  const cache = stateCache.get(selected) ?? new WeakMap();
  stateCache.set(selected, cache);
  const states = cache.get(payload) ?? readIssueStates(payload, selected);
  cache.set(payload, states);
  return states;
}

function readIssueStates(payload: PublicSeoPayload, selected: Selected) {
  const open = new Map<string, Issue>();
  // Devices a rule failed on, read from findings too: a finding can come without its checklist row.
  const failed: Devices = new Map(),
    // Devices where the rule fired with a note only: the check read the rule, and the issue is no longer open.
    noted: Devices = new Map();
  for (const finding of payload.findings) {
    if (!selected(finding.pageUrl)) continue;
    const key = issueKey(payload, finding);
    if (!SEO_ISSUE_SEVERITIES.has(finding.severity)) {
      // A note alone says the rule was read. Other kinds of finding say nothing about the issue.
      if (finding.severity === "note") addDevice(noted, key, finding.device);
      continue;
    }
    addDevice(failed, key, finding.device);
    const severity = finding.severity as Issue["severity"];
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
  const passed: Devices = new Map(),
    fired: Devices = new Map();
  // Every row counts, also two rows of one rule on one device: one that fired still blocks a fix.
  for (const check of payload.checks) {
    if (check.result !== "pass" && check.result !== "fired") continue;
    if (!selected(check.pageUrl)) continue;
    const key = issueKey(payload, check);
    addDevice(check.result === "pass" ? passed : fired, key, check.device);
    // A rule that fired with a note only did not fail there.
    if (check.result === "fired" && !noted.get(key)?.has(check.device))
      addDevice(failed, key, check.device);
  }
  // A rule that also fired on a device without a finding failed on more than the device its finding names.
  for (const [key, issue] of open)
    if ((failed.get(key)?.size ?? 0) > 1)
      open.set(key, { ...issue, device: null });
  return { open, passed, fired, failed, noted };
}

const bySeverity = (a: Issue, b: Issue) =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);

/**
 * What the later check changed against the earlier one, per issue of the selected pages. An issue is new only where
 * the earlier check read its rule on a device that fails now and found no issue, and fixed only where the later check read it on every device it failed on and
 * found no issue: a pass, or a note alone.
 */
export function compareSeoRuns(
  previous: Pick<SeoRunDiffSource, "observedAt" | "payload">,
  latest: Pick<SeoRunDiffSource, "observedAt" | "payload">,
  selected: Selected,
): Omit<SeoRunDiff, "numbers"> & {
  issues: SeoRunDiff["numbers"]["issues"];
  moves: SeoRunDiff["numbers"]["moves"];
} {
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
      // New only where the earlier check read the rule on a device that fails now and found no issue there.
      else if (
        [...(after.failed.get(key) ?? [])].some(
          (device) =>
            before.passed.get(key)?.has(device) ||
            before.noted.get(key)?.has(device),
        )
      )
        added.push(issue);
      else notCheckedBefore += 1;
    }
    for (const [key, issue] of before.open) {
      if (after.open.has(key)) continue;
      const noted = after.noted.get(key);
      const read = new Set([
        ...(after.passed.get(key) ?? []),
        ...(noted ?? []),
      ]);
      if (
        [...(before.failed.get(key) ?? [])].every((device) =>
          read.has(device),
        ) &&
        [...(after.fired.get(key) ?? [])].every((device) => noted?.has(device))
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
    // The issues this comparison reads, so the two totals always add up to its lists.
    issues: reason
      ? { from: null, to: null }
      : { from: before.open.size, to: after.open.size },
    moves,
  };
}

/**
 * The check to compare with: the latest earlier check of the same kind that read every selected page, with the same
 * Market and rulebook where one exists. Checks of two Markets that take turns each keep their own line.
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
        issues: { from: null, to: null },
        moves: [],
      },
    };
  const mismatch = (source: SeoRunDiffSource) =>
    seoRunMismatch(source.payload, run.payload);
  const previous =
    full.find((source) => !mismatch(source)) ??
    full.find((source) => mismatch(source) !== "market") ??
    full[0];
  return { previous, diff: compareSeoRuns(previous, run, selected) };
}

/** Each check with what it changed against the earlier comparable check. The first check of a kind has none. */
export function withSeoRunDiffs<T extends { observationId: string }>(
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
  return runs.map((run) => {
    const source = sources.find((item) => item.id === run.observationId);
    const pair = source && seoRunDiffOf(source, sources, selectedIds, selected);
    if (!pair) return run;
    const { moves, issues, ...lists } = pair.diff;
    return {
      ...run,
      runDiff: {
        ...lists,
        numbers: {
          issues,
          moves: moves.slice(0, SEO_RUN_DIFF_ITEMS),
          moveCount: moves.length,
        },
      },
    };
  });
}
