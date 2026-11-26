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

/** What the workspace read adds to its own checks for the comparison. */
export interface SeoRunDiffInput {
  /** Checks older than a full evidence list: a check can compare with one of them, and they show nowhere else. */
  diffBaselines?: SeoRunDiffSource[];
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
    // Devices an issue finding names: the devices a page issue is open on.
    issued: Devices = new Map(),
    // Devices where the rule fired with a note only: the check read the rule, and the issue is no longer open.
    noted: Devices = new Map();
  // Notes per rule and device: each note accounts for one row that fired, not for every row there.
  const notes = new Map<string, number>();
  for (const finding of payload.findings) {
    if (!selected(finding.pageUrl)) continue;
    const key = issueKey(payload, finding);
    if (!SEO_ISSUE_SEVERITIES.has(finding.severity)) {
      // A note alone says the rule was read. Other kinds of finding say nothing about the issue.
      if (finding.severity === "note") {
        addDevice(noted, key, finding.device);
        const at = `${key}\n${finding.device}`;
        notes.set(at, (notes.get(at) ?? 0) + 1);
      }
      continue;
    }
    addDevice(failed, key, finding.device);
    addDevice(issued, key, finding.device);
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
    // Devices a row fired on, also with a note: where a finding that names no device is open.
    fired: Devices = new Map();
  // Every row counts, also two rows of one rule on one device: one that fired still blocks a fix.
  for (const check of payload.checks) {
    if (check.result !== "pass" && check.result !== "fired") continue;
    if (!selected(check.pageUrl)) continue;
    const key = issueKey(payload, check);
    if (check.result === "pass") addDevice(passed, key, check.device);
    // A row that fired with a note of its own did not fail there. A row with no note left failed.
    if (check.result !== "fired") continue;
    addDevice(fired, key, check.device);
    const at = `${key}\n${check.device}`;
    const left = notes.get(at) ?? 0;
    if (left) notes.set(at, left - 1);
    else addDevice(failed, key, check.device);
  }
  // A rule that also fired on a device without a finding failed on more than the device its finding names.
  for (const [key, issue] of open)
    if ((failed.get(key)?.size ?? 0) > 1)
      open.set(key, { ...issue, device: null });
  return { open, passed, failed, fired, issued, noted };
}

const measuredRules = (payload: PublicSeoPayload) =>
  payload.checks.length > 0 || payload.findings.length > 0;

/** The rules a check tested: every rule it stored a row or a finding for. */
const testedRules = (payload: PublicSeoPayload) =>
  new Set([...payload.checks, ...payload.findings].map((row) => row.rowId));

/** The rules both checks tested, and how many only one of them tested. */
function sharedRules(before: PublicSeoPayload, after: PublicSeoPayload) {
  const earlier = testedRules(before),
    later = testedRules(after);
  const ids = new Set([...later].filter((id) => earlier.has(id)));
  return {
    ids,
    compared: ids.size,
    other: earlier.size + later.size - 2 * ids.size,
  };
}

/** The check with the findings of these rules only: an issue comes from a finding, so the rows of other rules name none. */
const onlyRules = (
  payload: PublicSeoPayload,
  ids: ReadonlySet<string>,
): PublicSeoPayload => ({
  ...payload,
  findings: payload.findings.filter((row) => ids.has(row.rowId)),
});

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
  const mismatch = seoRunMismatch(previous.payload, latest.payload);
  // Across a rulebook change only the rules both checks tested are compared. Without such a rule nothing is.
  const shared =
    mismatch === "rulebook"
      ? sharedRules(previous.payload, latest.payload)
      : null;
  const reason = shared?.compared ? null : mismatch;
  const earlier = shared
      ? onlyRules(previous.payload, shared.ids)
      : previous.payload,
    later = shared ? onlyRules(latest.payload, shared.ids) : latest.payload;
  const before = issueStates(earlier, selected),
    after = issueStates(later, selected);
  const added: Issue[] = [],
    fixed: Issue[] = [],
    stillOpen: Issue[] = [];
  let notCheckedAgain = 0,
    notCheckedBefore = 0;
  if (!reason) {
    for (const [key, issue] of after.open) {
      if (before.open.has(key)) stillOpen.push(issue);
      // New only where the earlier check read the rule on a device that fails now and found no issue there:
      // a pass beside a row that fired on the same device is no clear result.
      else {
        const clear = (device: string | null) =>
          !before.failed.get(key)?.has(device) &&
          (before.passed.get(key)?.has(device) ||
            before.noted.get(key)?.has(device));
        // A finding that names no device is new only where every device a row fired on was clear before, and
        // never without such a row.
        const anyDevice = after.issued.get(key)?.has(null);
        const devices = anyDevice
          ? [...(after.fired.get(key) ?? [])].filter((device) => device)
          : [...(after.issued.get(key) ?? [])];
        if (
          anyDevice
            ? devices.length > 0 && devices.every(clear)
            : devices.some(clear)
        )
          added.push(issue);
        else notCheckedBefore += 1;
      }
    }
    for (const [key, issue] of before.open) {
      if (after.open.has(key)) continue;
      const read = new Set([
        ...(after.passed.get(key) ?? []),
        ...(after.noted.get(key) ?? []),
      ]);
      // Every row that fired now has a note of its own, so no device failed.
      if (
        [...(before.failed.get(key) ?? [])].every((device) =>
          read.has(device),
        ) &&
        !after.failed.has(key)
      )
        fixed.push(issue);
      else notCheckedAgain += 1;
    }
  }
  const moves = reason
    ? []
    : seoRankMoves(earlier, later).filter((move) => selected(move.pageUrl));
  const list = (issues: Issue[]) =>
    issues.sort(bySeverity).slice(0, SEO_RUN_DIFF_ITEMS);
  return {
    from: previous.observedAt.toISOString(),
    to: latest.observedAt.toISOString(),
    comparable: !reason,
    ...(reason && { reason }),
    ...(!reason &&
      shared && {
        rulebookChange: { compared: shared.compared, other: shared.other },
      }),
    new: list(added),
    newCount: added.length,
    fixed: list(fixed),
    fixedCount: fixed.length,
    stillOpen: list(stillOpen),
    stillOpenCount: stillOpen.length,
    notCheckedAgain,
    notCheckedBefore,
    // The issues this comparison reads, so the two totals always add up to its lists.
    // A check that stored no rule row and no finding measured no page rule: it has no issue count.
    issues: reason
      ? { from: null, to: null }
      : {
          from: measuredRules(earlier) ? before.open.size : null,
          to: measuredRules(later) ? after.open.size : null,
        },
    moves,
  };
}

/** The checks that test the rules of a page. */
const PAGE_RULE_KINDS = new Set(["page_check", "audit_lite", "audit_full"]);

/**
 * A check of page rules read a page where one of its rules passed, fired or left a finding there. A page it names but
 * only blocked was not read, nor a page of a check that stored no checklist rows: a note alone is no read. Such a
 * check that read rankings, or a check of another kind, such as a ranking check, is read by the pages it names.
 */
function readsEveryUrl(
  payload: PublicSeoPayload,
  selectedUrls: ReadonlySet<string>,
) {
  if (!PAGE_RULE_KINDS.has(payload.kind)) return true;
  if (!payload.checks.length) {
    // Such a check read a page only where it holds a usable rank for that page.
    const ranked = new Set(
      payload.keywords
        .filter((row) => row.positionStatus !== "unavailable")
        .map((row) => normalizeSeoUrl(row.pageUrl)),
    );
    return [...selectedUrls].every((url) => ranked.has(normalizeSeoUrl(url)));
  }
  const read = new Set(
    [
      ...payload.checks.filter(
        (check) => check.result === "pass" || check.result === "fired",
      ),
      ...payload.findings,
    ].map((row) => normalizeSeoUrl(row.pageUrl)),
  );
  return [...selectedUrls].every((url) => read.has(normalizeSeoUrl(url)));
}

/**
 * The check to compare with: the latest earlier check of the same kind that read every selected page, with the same
 * Market and rulebook where one exists. Checks of two Markets that take turns each keep their own line.
 */
function seoRunDiffOf(
  run: SeoRunDiffSource,
  sources: SeoRunDiffSource[],
  readsAll: (source: SeoRunDiffSource) => boolean,
  selected: Selected,
) {
  const earlier = sources
    .filter(
      (source) =>
        source.kind === run.kind && source.observedAt < run.observedAt,
    )
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  if (!earlier.length) return null;
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
        rulebookChange: undefined,
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
    sources: shown,
    diffBaselines = [],
    selectedIds,
    selectedUrls,
  }: SeoRunDiffInput & {
    sources: SeoRunDiffSource[];
    selectedIds: ReadonlySet<string>;
    selectedUrls: ReadonlySet<string>;
  },
): Array<T & { runDiff?: SeoRunDiff }> {
  const selected: Selected = (url) => selectedUrls.has(normalizeSeoUrl(url));
  // Behind the checks the read shows, which come newest first: the stable sort pairs a check of the same time with a shown check first.
  const sources = [...shown, ...diffBaselines];
  // Read once per check: every later check asks it again.
  const reads = new Map(
    sources.map((source) => [
      source.id,
      [...selectedIds].every((id) => source.pageIds.includes(id)) &&
        readsEveryUrl(source.payload, selectedUrls),
    ]),
  );
  const readsAll = (source: SeoRunDiffSource) => reads.get(source.id) ?? false;
  return runs.map((run) => {
    const source = sources.find((item) => item.id === run.observationId);
    const pair = source && seoRunDiffOf(source, sources, readsAll, selected);
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
