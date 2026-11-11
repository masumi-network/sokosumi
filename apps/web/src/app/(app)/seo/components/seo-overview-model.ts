import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

const ISSUE_SEVERITIES = { critical: 0, major: 1, minor: 2 } as const;
/** Issue severities, worst first. */
export const SEO_ISSUE_SEVERITY_NAMES = Object.keys(
  ISSUE_SEVERITIES,
) as SeoIssueSeverity[];
const NON_ISSUE_RANK = SEO_ISSUE_SEVERITY_NAMES.length;

export type SeoIssueSeverity = keyof typeof ISSUE_SEVERITIES;
type Finding = ProjectSeoWorkspace["findings"][number];
type Action = ProjectSeoWorkspace["actions"][number];

// The page check names raw-HTML rows "Raw HTML: <rule>"; the check's record already says so.
const RAW_HTML_PREFIX = "Raw HTML: ";

/** A check row's title without the "Raw HTML: " source prefix. */
export function checkName(title: string) {
  return title.startsWith(RAW_HTML_PREFIX)
    ? title.slice(RAW_HTML_PREFIX.length)
    : title;
}

function issueRank(finding: Finding): number {
  return finding.severity in ISSUE_SEVERITIES
    ? ISSUE_SEVERITIES[finding.severity as keyof typeof ISSUE_SEVERITIES]
    : NON_ISSUE_RANK;
}

/** Severity describes an issue. Measurements and notes do not imply a fix. */
export function seoOverviewModel(workspace: ProjectSeoWorkspace) {
  const failed = workspace.findings
    .filter((finding) => issueRank(finding) < NON_ISSUE_RANK)
    .toSorted((left, right) => issueRank(left) - issueRank(right));
  // One rule that fails on mobile and on desktop is one issue on that page; the row names its devices.
  const issues = [
    ...Map.groupBy(failed, (finding) =>
      JSON.stringify([finding.observationId, finding.rowId, finding.pageUrl]),
    ).values(),
  ].map((group) => ({
    ...group[0],
    // Only rows with an issue severity reach this list.
    severity: group[0].severity as SeoIssueSeverity,
    findingIds: group.map(({ id }) => id),
    devices: [
      ...new Set(group.flatMap(({ device }) => (device ? [device] : []))),
    ],
    evidence: [...new Set(group.flatMap(({ evidence }) => evidence))],
  }));
  // Each device of one check can report the same measurement; one check shows it once.
  const diagnostics = [
    ...new Map(
      workspace.findings
        .filter((finding) => issueRank(finding) === NON_ISSUE_RANK)
        .map((finding) => [
          JSON.stringify([
            finding.observationId,
            finding.severity,
            finding.title,
            finding.pageUrl,
            finding.evidence,
          ]),
          finding,
        ]),
    ).values(),
  ];
  // A device row takes the rating of its issue, so an action and its issue show the same severity.
  const findingRanks = new Map(
    issues.flatMap((issue) =>
      issue.findingIds.map((id) => [id, issueRank(issue)] as const),
    ),
  );
  const actionRank = (action: Action) =>
    Math.min(
      NON_ISSUE_RANK,
      ...action.findingIds.map((id) => findingRanks.get(id) ?? NON_ISSUE_RANK),
    );
  // Preserve strategic proposals without findings and all existing Task history.
  const actions = workspace.actions.toSorted(
    (left, right) => actionRank(left) - actionRank(right),
  );
  // The worst issue an action fixes; an action from search data alone has none.
  const actionSeverity = (action: Action) =>
    SEO_ISSUE_SEVERITY_NAMES[actionRank(action)] ?? null;
  // What is wrong, in the check's own words: the worst issue the action fixes and its first evidence line, named as Health names it.
  // The line alone can be a bare count ("4 of 20 images"), so the name of the check goes with it.
  const actionProblem = (action: Action) => {
    const issue = issues.find((issue) =>
      action.findingIds.some((id) => issue.findingIds.includes(id)),
    );
    // A line of white space only says nothing.
    const found = issue?.evidence.find((line) => line.trim());
    return issue && found ? { check: checkName(issue.title), found } : null;
  };
  const fixOf = (issue: { findingIds: string[] }) =>
    actions.find((action) =>
      action.findingIds.some((id) => issue.findingIds.includes(id)),
    ) ?? null;
  // The action that fixes an issue names the problem; the issue's own title names the test.
  // One action can fix several issues: its title then names none of them.
  const issueFix = (issue: { findingIds: string[] }) => {
    const action = fixOf(issue);
    return action
      ? {
          action,
          named: issues.filter((other) => fixOf(other) === action).length === 1,
        }
      : null;
  };
  const recommendedActions = actions.filter(
    (action) => action.status === "recommended",
  );
  const recentChecks = workspace.analyses.filter(
    (analysis) => analysis.status !== "completed",
  );
  const hasCheckedEvidence = workspace.observations.some(
    (observation) => observation.coverage.checked > 0,
  );
  const hasFailedChecks =
    workspace.observations.some(
      (observation) =>
        observation.coverage.failed > 0 ||
        (observation.coverage.modules?.failed ?? 0) > 0,
    ) ||
    (!hasCheckedEvidence &&
      workspace.analyses.some((analysis) => analysis.status === "failed"));
  const emptyState = issues.length
    ? "issues"
    : hasFailedChecks
      ? "incomplete"
      : hasCheckedEvidence
        ? "no_fixes"
        : "no_checks";
  return {
    issues,
    diagnostics,
    actions,
    actionSeverity,
    actionProblem,
    issueFix,
    recommendedActions,
    recentChecks,
    hasFailedChecks,
    emptyState,
  };
}

/**
 * Per page in the current view: open issues and the newest check that covered it.
 * The workspace holds findings and checks only for the viewed pages and dates, so a
 * page outside the view gets no summary rather than a false "no issues". A cut history
 * cannot prove a page was never checked, so such a page gets no summary either.
 */
export function seoPageSummaries(workspace: ProjectSeoWorkspace) {
  const { issues } = seoOverviewModel(workspace);
  const viewed = new Set(workspace.scope.pageIds);
  const summaries = new Map<
    string,
    {
      issues: number;
      checkedAt: Date | string | null;
      checkId: string | null;
      incomplete: boolean;
    }
  >();
  for (const page of workspace.pages) {
    if (!viewed.has(page.id)) continue;
    // Observations come newest first.
    // A check where every rule was unavailable still ran; one that skipped every rule did not.
    const check = workspace.observations.find(
      ({ coverage, pageIds }) =>
        (coverage.checked > 0 ||
          coverage.failed > 0 ||
          (coverage.modules?.failed ?? 0) > 0) &&
        pageIds.includes(page.id),
    );
    if (!check && workspace.history.limited) continue;
    summaries.set(page.id, {
      issues: issues.filter((finding) => finding.pageUrl === page.url).length,
      checkedAt: check?.observedAt ?? null,
      // Only a check with a Task has results to open.
      checkId: check?.sourceTaskId ? check.id : null,
      // A check with unavailable rules cannot say "no issues", as on the Overview.
      incomplete: Boolean(
        check &&
          (check.coverage.failed > 0 ||
            (check.coverage.modules?.failed ?? 0) > 0),
      ),
    });
  }
  return summaries;
}

/**
 * A measurement's value without the leading words its name already says:
 * "Title length" with "title 56 characters" gives "56 characters".
 * At least one word stays; text that does not start with the name stays whole.
 */
export function measureValue(name: string, evidence: string) {
  const nameWords = name.trim().toLowerCase().split(/\s+/);
  const words = evidence.trim().split(/\s+/);
  let shared = 0;
  while (
    shared < words.length - 1 &&
    shared < nameWords.length &&
    words[shared].toLowerCase() === nameWords[shared]
  )
    shared++;
  return shared ? words.slice(shared).join(" ") : evidence;
}

/** The check names where it read the page in a line starting "Source:"; that is provenance, not guidance. */
const SOURCE_LINE_PREFIX = "Source:";

type PageDetailRow = {
  name: string;
  evidence: readonly string[];
};

/** The check's guidance shown under a row's value: its later evidence lines, without provenance. */
export function pageDetailGuidance(evidence: readonly string[]) {
  return evidence
    .slice(1)
    .filter((line) => !line.startsWith(SOURCE_LINE_PREFIX));
}

/**
 * The rows that show their guidance: the first row with each rule's lines.
 * The same lines on another page would repeat; different lines still show.
 */
export function pageDetailGuidanceRows(
  rows: readonly (PageDetailRow & { id: string })[],
) {
  const first = new Map<string, string>();
  for (const row of rows) {
    const guidance = pageDetailGuidance(row.evidence);
    const key = [row.name, ...guidance].join("\n");
    if (guidance.length && !first.has(key)) first.set(key, row.id);
  }
  return new Set(first.values());
}

/**
 * What folds under page details: each provenance line once.
 * A line all rows share drops the row names; otherwise it names the rows it came from.
 */
export function pageDetailReferences(rows: readonly PageDetailRow[]) {
  const lines = new Map<string, { names: Set<string>; rows: number }>();
  for (const row of rows)
    for (const line of new Set(row.evidence.slice(1)))
      if (line.startsWith(SOURCE_LINE_PREFIX)) {
        const seen = lines.get(line) ?? { names: new Set<string>(), rows: 0 };
        seen.names.add(row.name);
        seen.rows += 1;
        lines.set(line, seen);
      }
  // Rows, not names, decide "all share it": one rule can sit on several pages.
  return [...lines].map(([line, seen]) => ({
    line,
    names: rows.length > 1 && seen.rows === rows.length ? [] : [...seen.names],
  }));
}

/** A rule ID the check cites, e.g. "(N1-246)": provenance, not reading text. */
const RULE_CODE = /\s*\(([A-Z][A-Z0-9]*-\d+)\)/g;

/** A guidance line as people read it: without the rule IDs it cites. */
export function withoutRuleCodes(line: string) {
  return line.replace(RULE_CODE, "");
}

/** Every rule ID the shown guidance cites, once, in order: they fold with the sources. */
export function pageDetailRuleCodes(lines: readonly string[]) {
  return [
    ...new Set(
      lines.flatMap((line) => [...line.matchAll(RULE_CODE)].map((m) => m[1])),
    ),
  ];
}

const TOOL_RANGES_PREFIX = "vendor tools:";

/** The ranges on a guidance line that lists the tools' ranges; undefined for any other line. */
export function toolRangesList(line: string) {
  return line.startsWith(TOOL_RANGES_PREFIX)
    ? withoutRuleCodes(line.slice(TOOL_RANGES_PREFIX.length)).trim()
    : undefined;
}
const TOOL_RANGE_FORMS: readonly [
  RegExp,
  (a: number, b: number) => (value: number) => boolean,
][] = [
  [/^(.+?) under (\d+)$/, (max) => (value) => value < max],
  [
    /^(.+?) (\d+) to (\d+)$/,
    (min, max) => (value) => value >= min && value <= max,
  ],
  [/^(.+?) (\d+) or more$/, (min) => (value) => value >= min],
];

/**
 * Where a measured number sits against the tools' ranges in its guidance.
 * Null unless the value starts with a whole number and every range reads as one known form:
 * a range read wrong would tell the owner to act when nothing is wrong.
 */
export function toolRangeFit(value: string, guidance: readonly string[]) {
  const measured = /^(\d+)(?:\s|$)/.exec(value.trim());
  const line = guidance.find((entry) => entry.startsWith(TOOL_RANGES_PREFIX));
  if (!measured || !line) return null;
  const number = Number(measured[1]);
  const outside: string[] = [];
  const ranges = withoutRuleCodes(line.slice(TOOL_RANGES_PREFIX.length))
    .split(";")
    .map((range) => range.trim());
  for (const range of ranges) {
    const form = TOOL_RANGE_FORMS.find(([pattern]) => pattern.test(range));
    if (!form) return null;
    const [, tool, a, b] = range.match(form[0]) ?? [];
    if (!form[1](Number(a), Number(b))(number)) outside.push(tool);
  }
  return { total: ranges.length, outside };
}

/**
 * A note's first evidence line split into what the check found and its value,
 * e.g. "meta keywords in head: \"...\"". A ": " inside a quote ("", “” or „“) is part of the
 * finding, not its label. A line without a label is all finding.
 */
export function noteFinding(line: string) {
  let split = line.indexOf(": ");
  while (split > 0 && (line.slice(0, split).match(/["“”„]/g)?.length ?? 0) % 2)
    split = line.indexOf(": ", split + 1);
  return split > 0
    ? { found: line.slice(0, split), detail: line.slice(split + 2) }
    : { found: line, detail: undefined };
}

/** Measurements whose value falls outside at least one tool range in their own guidance. */
export function measuresOutsideToolRanges(diagnostics: readonly Finding[]) {
  // Two checks can measure one rule on one page; rows come newest first, so only the newest
  // check counts. Its desktop and mobile rows can differ; either one outside a range is a step.
  // findingIds lists every row the suggestion covers, so rows and counts agree.
  const newest = new Map<string, string>();
  const found = new Map<
    string,
    {
      name: string;
      value: string;
      tools: string[];
      pageUrl: string;
      observationId: string;
      findingIds: string[];
    }
  >();
  for (const finding of diagnostics) {
    const first = finding.evidence[0];
    if (finding.severity !== "measure" || first === undefined) continue;
    const name = checkName(finding.title);
    const key = JSON.stringify([name, finding.pageUrl]);
    if (!newest.has(key)) newest.set(key, finding.observationId);
    if (newest.get(key) !== finding.observationId) continue;
    const value = measureValue(name, first);
    const fit = toolRangeFit(value, pageDetailGuidance(finding.evidence));
    if (!fit?.outside.length) continue;
    const known = found.get(key);
    if (known) known.findingIds.push(finding.id);
    else
      found.set(key, {
        name,
        value,
        tools: fit.outside,
        pageUrl: finding.pageUrl,
        observationId: finding.observationId,
        findingIds: [finding.id],
      });
  }
  return [...found.values()];
}
