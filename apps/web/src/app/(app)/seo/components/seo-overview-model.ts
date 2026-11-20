import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoIssueKey } from "@sokosumi/utils";

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

/** A finding's check time; its rows may carry later times per device. */
export function seoCheckedAt(
  workspace: ProjectSeoWorkspace,
  finding: Pick<Finding, "observationId" | "observedAt">,
) {
  return (
    workspace.observations.find(
      (observation) => observation.id === finding.observationId,
    )?.observedAt ?? finding.observedAt
  );
}

/** Severity describes an issue. Measurements and notes do not imply a fix. */
export function seoOverviewModel(workspace: ProjectSeoWorkspace) {
  const failed = workspace.findings
    .filter((finding) => issueRank(finding) < NON_ISSUE_RANK)
    .toSorted((left, right) => issueRank(left) - issueRank(right));
  // One rule that fails on mobile and on desktop is one issue on that page; the row names its devices.
  const issues = [...Map.groupBy(failed, seoIssueKey).values()].map(
    (group) => ({
      ...group[0],
      // Only rows with an issue severity reach this list.
      severity: group[0].severity as SeoIssueSeverity,
      findingIds: group.map(({ id }) => id),
      devices: [
        ...new Set(group.flatMap(({ device }) => (device ? [device] : []))),
      ],
      evidence: [...new Set(group.flatMap(({ evidence }) => evidence))],
    }),
  );
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
  // What is wrong, in the check's own words: the worst issue the action fixes and its first evidence line, named as its issue row names it.
  // The line alone can be a bare count ("4 of 20 images"), so the name of the check goes with it.
  const actionProblem = (action: Action) => {
    const issue = issues.find((issue) =>
      action.findingIds.some((id) => issue.findingIds.includes(id)),
    );
    // A line of white space only says nothing.
    const line = issue?.evidence.find((line) => line.trim());
    if (!issue || !line) return null;
    // A bracket that ends the line is the rule's footnote: the card shows it with the details.
    // The footnote can hold brackets of its own, so the cut is at the bracket that the last one closes.
    let open = -1;
    if (line.endsWith(")")) {
      let depth = 0;
      for (let at = line.length - 1; at >= 0 && open < 0; at--) {
        if (line[at] === ")") depth++;
        else if (line[at] === "(" && --depth === 0) open = at;
      }
    }
    // A bracket with no space before it belongs to its word; a line that is a bracket alone stays whole.
    const cut =
      open > 0 && line[open - 1] === " " && line.slice(0, open).trim()
        ? open - 1
        : line.length;
    return {
      check: checkName(issue.title),
      found: line.slice(0, cut),
      footnote: line.slice(cut + 1) || null,
    };
  };
  // An issue with an action has its card on the Actions tab; the list under the cards keeps the rest.
  const unplanned = issues.filter(
    (issue) =>
      !actions.some((action) =>
        action.findingIds.some((id) => issue.findingIds.includes(id)),
      ),
  );
  const recommendedActions = actions.filter(
    (action) => action.status === "recommended",
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
    unplanned,
    recommendedActions,
    hasFailedChecks,
    emptyState,
  };
}

/** The worklist group of an action: a suggestion by its kind; a fix by its impact, and an unrated fix counts as low. */
export type SeoActionBucket = "high" | "low" | "suggestions";

export function seoActionBucket(
  action: Pick<ProjectSeoWorkspace["actions"][number], "kind">,
  severity: SeoIssueSeverity | null,
): SeoActionBucket {
  if (action.kind === "opportunity") return "suggestions";
  return severity === "critical" || severity === "major" ? "high" : "low";
}

/** The filters of the worklist: All, then each group with rows. */
export const SEO_ACTION_FILTERS = [
  "all",
  "high",
  "low",
  "suggestions",
  "reviews",
] as const;
/** The message key of each filter's label: the impact groups use the words of the impact marks. */
export const SEO_ACTION_FILTER_LABEL = {
  all: "actions.filter.all",
  high: "severity.major",
  low: "severity.minor",
  suggestions: "actions.filter.suggestions",
  reviews: "actions.reviewAgain",
} as const satisfies Record<(typeof SEO_ACTION_FILTERS)[number], string>;

export type SeoActionFilter = (typeof SEO_ACTION_FILTERS)[number];

/**
 * The worklist of the Actions tab: the count of each group, and the filters worth offering. A filter that
 * shows every row or none says nothing, so only the filters that split the list are offered.
 */
export function seoActionWorklist<
  Action extends { kind: string; followUpReview?: unknown },
>(actions: readonly Action[], bucket: (action: Action) => SeoActionBucket) {
  const reviewRows = actions.filter((action) => action.followUpReview);
  const ordered = reviewRows.length
    ? [...reviewRows, ...actions.filter((action) => !action.followUpReview)]
    : actions;
  const counts = {
    all: actions.length,
    high: 0,
    low: 0,
    suggestions: 0,
    reviews: reviewRows.length,
  };
  for (const action of actions) counts[bucket(action)] += 1;
  const filters = SEO_ACTION_FILTERS.filter(
    (key) => key === "all" || (counts[key] > 0 && counts[key] < actions.length),
  );
  return {
    counts,
    filters,
    rows: (filter: SeoActionFilter) =>
      filter === "all"
        ? ordered
        : filter === "reviews"
          ? reviewRows
          : ordered.filter((action) => bucket(action) === filter),
  };
}

/** The fixes that wait for the reader: the count the Agent tab and the Keywords card lead with. */
export function seoOpenFixes(
  overview: Pick<ReturnType<typeof seoOverviewModel>, "recommendedActions">,
) {
  return overview.recommendedActions.filter((action) => action.kind === "fix");
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
    // Only a cut of the checks can hide this page's check; a cut of the syncs cannot.
    // A workspace read by an older Core has no evidenceLimited: either cut then counts.
    if (
      !check &&
      (workspace.history.evidenceLimited ?? workspace.history.limited)
    )
      continue;
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

/** A row's lines without the provenance lines ("Source: …"), which fold once under page details. */
export function pageDetailLines(evidence: readonly string[]) {
  return evidence.filter((line) => !line.startsWith(SOURCE_LINE_PREFIX));
}

/** The check's guidance shown under a row's value: its later evidence lines, without provenance. */
export function pageDetailGuidance(evidence: readonly string[]) {
  return evidence
    .slice(1)
    .filter((line) => !line.startsWith(SOURCE_LINE_PREFIX));
}

/**
 * A line naming one flagged image, e.g. "camera file name: https://example.com/img_1631.jpg" (seo-bot O-21, O-18).
 * Only these labels: other rows write "label: value" lines that are page facts, not lists.
 */
const ITEM_LINE = /^(camera file name|img without alt): (.+)$/;
/** A link the check read and the site's answer, e.g. "https://example.com/a/ → 404" (seo-bot IL-04). */
const LINK_STATUS_LINE = /^(https?:\/\/\S+) → (.+)$/;
/** The message key of each item label, so the list's caption is in the reader's language. */
export const ITEM_LABEL_KEYS = {
  "camera file name": "cameraFileName",
  "img without alt": "imgWithoutAlt",
  "link status": "linkStatus",
} as const;

/** One flagged item: a file or link, and the site's answer when the check read one. */
export type PageDetailItem = { value: string; status?: string };
/** The bot's count of the items it left out after its first ten, e.g. "+2 more". */
const MORE_LINE = /^\+(\d+) more$/;

/**
 * A row's later lines split into the items the check flagged, grouped by their label, and its guidance.
 * Items belong to their page, so they show on every row; guidance shows once per rule.
 */
export function pageDetailItems(lines: readonly string[]) {
  type Group = { values: PageDetailItem[]; more: number };
  const groups = new Map<string, Group>();
  const guidance: string[] = [];
  let last: Group | undefined;
  const add = (label: string, item: PageDetailItem) => {
    last = groups.get(label) ?? { values: [], more: 0 };
    last.values.push(item);
    groups.set(label, last);
  };
  for (const line of lines) {
    const item = ITEM_LINE.exec(line);
    const link = LINK_STATUS_LINE.exec(line);
    const more = MORE_LINE.exec(line);
    if (item) add(item[1], { value: item[2] });
    else if (link) add("link status", { value: link[1], status: link[2] });
    else if (more && last) last.more += Number(more[1]);
    else {
      // A "+N more" after guidance is not the list's.
      last = undefined;
      guidance.push(line);
    }
  }
  return {
    groups: [...groups].map(([label, group]) => ({
      label: ITEM_LABEL_KEYS[label as keyof typeof ITEM_LABEL_KEYS],
      ...group,
    })),
    guidance,
  };
}

function decoded(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * An item as people scan it: a URL's file name, e.g. "img_1631-1.jpg", not its host and query.
 * Null for an image written into the page (a data: URL), which has no name.
 */
export function pageDetailItemName(value: string) {
  if (value.startsWith("data:")) return null;
  const path = URL.canParse(value)
    ? new URL(value).pathname
    : value.split(/[?#]/)[0];
  const last = path.split("/").filter(Boolean).pop();
  return last ? decoded(last) : value;
}

/**
 * A link as people scan it: its path on the page's own site ("/haefen/"), else its host and path.
 * The bot already cut a long line ("…"), so the name keeps that mark.
 */
export function pageDetailLinkName(value: string, pageUrl: string) {
  if (!URL.canParse(value)) return value;
  const url = new URL(value);
  const sameSite = URL.canParse(pageUrl) && new URL(pageUrl).host === url.host;
  // The query stays: "/search?q=a" and "/search?q=b" are different links.
  const path = `${url.pathname}${url.search}`;
  return decoded(sameSite ? path : `${url.host}${path}`);
}

/**
 * An item's link: only a web address, never another scheme such as javascript:.
 * None for a value the bot cut at its line length ("…"): that address is not the file's.
 */
export function pageDetailItemHref(value: string) {
  if (value.endsWith("…")) return undefined;
  const url = URL.canParse(value) ? new URL(value) : null;
  return url && (url.protocol === "https:" || url.protocol === "http:")
    ? url.href
    : undefined;
}

/** The share line of a multi-item note, e.g. "6 of 23 image file names": how many items failed of how many. */
export function noteShare(line: string) {
  const share = /^(\d+) of (\d+) /.exec(line);
  return share ? { found: Number(share[1]), total: Number(share[2]) } : null;
}

/**
 * The rule IDs (seo-bot rows) whose note gets its own plain words: a title and why it matters. The check's
 * lines alone ("6 of 23 image file names", "meta keywords in head: …") do not say what is wrong.
 */
const PLAIN_NOTES = {
  "O-21": "cameraFileNames",
  "IL-04": "brokenLinks",
  "IN-04": "xDefault",
  "O-10": "metaKeywords",
  "P-23": "twoWayFacts",
  "SD-05": "retiredMarkup",
  "SN-02": "titlePerDevice",
  "EX-02": "noFieldData",
  "RN-02": "rawRenderedDiff",
  "AI-04": "googleExtended",
  "AC-15": "canonicalTarget",
  "SN-18": "siteName",
  "O-13": "queryWords",
  "MC-01": "shopping",
  "C-09": "authorship",
  "AC-19": "sitemap",
  "IL-08": "moneyLinked",
  "K-13": "twoForKeyword",
  "O-15": "noH1",
  "AC-22": "aiSearchBots",
} as const;
type PlainNoteKey = (typeof PLAIN_NOTES)[keyof typeof PLAIN_NOTES];
/** Every plain-note message key, so a test can check each language has its words. */
export const PLAIN_NOTE_KEYS: readonly PlainNoteKey[] =
  Object.values(PLAIN_NOTES);
/** Notes whose first line counts items ("6 of 23 …"): their heading says that count in words. */
const SHARE_NOTES = ["cameraFileNames", "brokenLinks"] as const;
type ShareNoteKey = (typeof SHARE_NOTES)[number];

/**
 * A note's plain words: with a share line, its count; else its title, with the check's lines in a fold.
 * Null for a rule with no plain words yet: the row shows the check's own finding.
 */
export function plainNote(
  rowId: string,
  first: string | undefined,
):
  | { kind: "share"; key: ShareNoteKey; found: number; total: number }
  | { kind: "title"; key: PlainNoteKey }
  | null {
  const key: PlainNoteKey | undefined =
    PLAIN_NOTES[rowId as keyof typeof PLAIN_NOTES];
  if (!key) return null;
  const share = first === undefined ? null : noteShare(first);
  return share && (SHARE_NOTES as readonly string[]).includes(key)
    ? { kind: "share", key: key as ShareNoteKey, ...share }
    : { kind: "title", key };
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
    const { guidance } = pageDetailItems(pageDetailGuidance(row.evidence));
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

/**
 * The page-detail rows that ask something of the owner: every note, every measurement no tool range
 * can judge, and every value some tool range leaves out. A value inside every range asks nothing.
 * Core already drops an older row a newer check of the same page, rule, device and market replaced.
 */
export function actionablePageDetails(diagnostics: readonly Finding[]) {
  return diagnostics.filter((finding) => {
    const first = finding.evidence[0];
    if (finding.severity !== "measure" || first === undefined) return true;
    const fit = toolRangeFit(
      measureValue(checkName(finding.title), first),
      pageDetailGuidance(finding.evidence),
    );
    return fit === null || fit.outside.length > 0;
  });
}
