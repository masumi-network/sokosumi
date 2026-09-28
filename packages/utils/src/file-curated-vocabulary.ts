import {
  countGraphemes,
  FILE_LABEL_DESCRIPTION_MAX_LENGTH,
  FILE_LABEL_NAME_MAX_GRAPHEMES,
  normalizeFileLabelName,
} from "./file-vocabulary.js";

/**
 * The vocabulary the model picks from. Product data, not user data.
 *
 * **The axis.** A **category** is *what kind of document this is* — one per
 * file. A **tag** is *which part of the business it belongs to* — many per
 * file. Keep them on those two axes when adding to this list. The pair that
 * will tempt you first is "Marketing copy" (a kind of document) against
 * "Marketing" (a part of the business); they are both here, deliberately, and
 * they are not duplicates.
 *
 * **Why it is here rather than made in the product.** A workspace used to
 * start with an empty vocabulary and no screen that could fill it, and an
 * empty vocabulary makes the suggestion job complete without calling the model
 * at all. So automatic tagging produced nothing, forever, in every workspace,
 * and reported success while doing it. One curated set, seeded on creation and
 * backfilled into existing workspaces, is what makes the feature exist.
 *
 * **Every category carries a description** because the description is the
 * rubric the model is scored against — a category with no description is a
 * label it has to guess the meaning of. Tags carry one for the same reason:
 * the shortlist sends descriptions to the model, and a bare word is a guess.
 *
 * **Size.** `SUGGESTION_VOCABULARY_MAX` is 30 across both kinds, with a floor
 * of 10 each. At 8 + 12 the whole set always reaches the model and nothing is
 * ever truncated, with ten slots spare for labels a workspace made by hand
 * before this existed.
 *
 * **Not in the list, on purpose.** "Image or media" is absent because an image
 * has no extracted text, so the model can never assign it — a label that
 * cannot be reached is decorative. "Data and analytics", "Customer",
 * "Support", "Planning" and "Partnership" are absent because each overlapped
 * an entry above it; the spare slots are the point.
 */

export interface CuratedFileLabel {
  kind: "CATEGORY" | "TAG";
  displayName: string;
  /** The rubric the model is scored against. Never empty. */
  description: string;
}

/**
 * Bumped when a name or description in this list changes.
 *
 * It is the existing per-row `WorkspaceLabel.vocabularyVersion`, not a new
 * field: a row seeded at a later version makes suggestions scored under the
 * older rubric read as `stale` through machinery that already ships.
 */
export const CURATED_VOCABULARY_VERSION = 1;

/** What kind of document this is. One per file. */
const CURATED_CATEGORIES: readonly CuratedFileLabel[] = [
  {
    kind: "CATEGORY",
    displayName: "Contract",
    description:
      "A binding agreement between parties: signed contracts, statements of work, NDAs, terms of service, amendments. Choose this when the document sets out obligations the parties have agreed to, not when it only proposes them.",
  },
  {
    kind: "CATEGORY",
    displayName: "Invoice or receipt",
    description:
      "A request for payment or a record of one: invoices, receipts, credit notes, payment confirmations, account statements. Choose this when the document names amounts owed or paid, not when it merely discusses pricing.",
  },
  {
    kind: "CATEGORY",
    displayName: "Brief or specification",
    description:
      "Instructions for work to be done: project briefs, requirements, technical specifications, design briefs, acceptance criteria. Choose this when the document tells someone what to build or deliver.",
  },
  {
    kind: "CATEGORY",
    displayName: "Report or analysis",
    description:
      "A finding presented to a reader: research reports, analyses, audits, post-mortems, reviews of work already done. Choose this when the document draws conclusions from evidence.",
  },
  {
    kind: "CATEGORY",
    displayName: "Meeting notes",
    description:
      "A record of what was said and decided: minutes, call notes, interview transcripts, workshop write-ups. Choose this when the document records a discussion rather than making an argument of its own.",
  },
  {
    kind: "CATEGORY",
    displayName: "Marketing copy",
    description:
      "Text written to be published to an audience: landing-page copy, social posts, ads, newsletters, press releases, product descriptions. Choose this when the intended readers are customers rather than colleagues.",
  },
  {
    kind: "CATEGORY",
    displayName: "Dataset or export",
    description:
      "Structured records rather than prose: spreadsheets, CSV exports, query results, logs, metric dumps. Choose this when the substance is rows and columns, even if prose introduces them.",
  },
  {
    kind: "CATEGORY",
    displayName: "Reference material",
    description:
      "Something kept to be consulted later: documentation, guides, handbooks, policies, style guides, glossaries, FAQs. Choose this when the document is written to be returned to rather than read once.",
  },
];

/** Which part of the business it belongs to. Many per file. */
const CURATED_TAGS: readonly CuratedFileLabel[] = [
  {
    kind: "TAG",
    displayName: "Finance",
    description:
      "Money: budgets, pricing, costs, revenue, payments, forecasts, financial reporting.",
  },
  {
    kind: "TAG",
    displayName: "Legal",
    description:
      "Legal exposure: contracts, compliance, licensing, liability, regulation, privacy law.",
  },
  {
    kind: "TAG",
    displayName: "Engineering",
    description:
      "Building software: architecture, code, APIs, infrastructure, deployment, defects.",
  },
  {
    kind: "TAG",
    displayName: "Design",
    description:
      "How something looks or is used: visual design, user experience, wireframes, brand assets, typography.",
  },
  {
    kind: "TAG",
    displayName: "Marketing",
    description:
      "Reaching an audience: campaigns, channels, positioning, messaging, growth, brand.",
  },
  {
    kind: "TAG",
    displayName: "Sales",
    description:
      "Winning customers: pipeline, proposals, negotiations, customer calls, quotas, renewals.",
  },
  {
    kind: "TAG",
    displayName: "Product",
    description:
      "What to build and why: roadmaps, feature decisions, user research, prioritisation, release scope.",
  },
  {
    kind: "TAG",
    displayName: "Operations",
    description:
      "Running the business day to day: process, vendors, logistics, internal tooling, procurement.",
  },
  {
    kind: "TAG",
    displayName: "People",
    description:
      "The people in the organisation: hiring, onboarding, performance, roles, staff policies.",
  },
  {
    kind: "TAG",
    displayName: "Strategy",
    description:
      "Where the organisation is going: plans, market analysis, competitive positioning, long-range goals.",
  },
  {
    kind: "TAG",
    displayName: "Security",
    description:
      "Protecting systems and data: access control, vulnerabilities, incidents, audits, threat models.",
  },
  {
    kind: "TAG",
    displayName: "Research",
    description:
      "Gathering evidence before deciding: market research, interviews, literature reviews, experiments.",
  },
];

export const CURATED_FILE_VOCABULARY: readonly CuratedFileLabel[] = [
  ...CURATED_CATEGORIES,
  ...CURATED_TAGS,
];

/**
 * The list as rows, with the normalized name the unique key compares on.
 *
 * One place derives it, so the seed on workspace creation and the backfill
 * migration cannot disagree about what `(kind, normalizedName)` a curated
 * entry occupies.
 */
export function curatedFileVocabularyRows(): {
  kind: "CATEGORY" | "TAG";
  displayName: string;
  normalizedName: string;
  description: string;
}[] {
  return CURATED_FILE_VOCABULARY.map((label) => ({
    kind: label.kind,
    displayName: label.displayName,
    normalizedName: normalizeFileLabelName(label.displayName),
    description: label.description,
  }));
}

/**
 * What is wrong with the list, if anything. Empty means it is shippable.
 *
 * Exported so a test can assert it rather than a reviewer eyeballing 20
 * entries against four separate limits. The route that a person would have
 * used enforces all of these; product data goes in behind the route, so
 * nothing else would.
 */
export function curatedFileVocabularyProblems(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const row of curatedFileVocabularyRows()) {
    const key = `${row.kind}:${row.normalizedName}`;
    if (seen.has(key)) problems.push(`duplicate ${key}`);
    seen.add(key);

    if (countGraphemes(row.displayName) > FILE_LABEL_NAME_MAX_GRAPHEMES) {
      problems.push(`name too long: ${row.displayName}`);
    }
    if (row.displayName.includes("<") || row.displayName.includes(">")) {
      problems.push(`name contains markup: ${row.displayName}`);
    }
    // The route refuses a CATEGORY with no description. Both kinds carry one
    // here, so this is asserted for both rather than only where it is refused.
    if (row.description.trim().length === 0) {
      problems.push(`empty description: ${row.displayName}`);
    }
    if (row.description.length > FILE_LABEL_DESCRIPTION_MAX_LENGTH) {
      problems.push(
        `description too long (${row.description.length}): ${row.displayName}`,
      );
    }
  }

  return problems;
}
