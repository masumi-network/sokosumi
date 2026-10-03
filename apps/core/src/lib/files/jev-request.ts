import { createHash } from "node:crypto";

import {
  labelEnvelopeTokens,
  rubricEnvelopeTokens,
} from "@/lib/files/jev-rubrics";

/**
 * Building a Jev request inside an exact token ceiling.
 *
 * The budget unit is tokens in the **entire serialized request** — the
 * repeated query, the ids, the keys and delimiters, the rubric, everything.
 * Fields are bounded, truncated at safe boundaries, serialized again and
 * re-measured; if the result is still over the ceiling it is rejected rather
 * than sent.
 *
 * We do not have Jev's tokenizer. Rather than estimate from characters and
 * hope, this module uses a documented **upper bound**: no byte-pair
 * tokenizer emits more tokens than the input has Unicode code points.
 * Over-counting costs us a few characters of excerpt; under-counting would
 * silently blow a paid budget.
 *
 * ## What "the entire request" had stopped meaning
 *
 * The bound used to add a flat 64-token allowance for "provider-added
 * framing we cannot see". That was true when the rubric and the question
 * lived in this body. They do not any more: the transport wraps this body
 * under `state` and adds the model id, the whole question map with an
 * instruction paragraph per rung, and the retention options. Measured,
 * that envelope is **750 code points for a relevance call and 603 for a
 * `belongs` call** — so the ceiling was under-counting every request by
 * roughly 540 to 690 tokens, and the docstring above was describing a
 * measurement that no longer happened.
 *
 * `rubricEnvelopeTokens` now serializes the real envelope and counts it, so
 * the figure follows the rubrics automatically when one is reworded. Live
 * reconciliation against reported usage still needs calls we are not
 * authorized to make, so the ceiling stays an estimate — but it is now an
 * estimate of the whole request rather than of the rubrics alone.
 *
 * This used to say `FILES_JEV_ENABLED` stays off by default. `env.ts` defaults
 * it to `"true"` and mainnet does not set it, so evaluation is on in
 * production: the docstring contradicted the schema it described.
 */

/**
 * Slack above the measured envelope, for transport framing we genuinely
 * cannot see — HTTP headers the provider adds, a chat template, a BOS
 * token. Small on purpose: the large, knowable part is measured now.
 */
export const PROVIDER_FRAMING_TOKEN_ALLOWANCE = 64;

export interface TokenCeilings {
  total: number;
  /** Per-component ceilings, in priority order for trimming. */
  components: Record<string, number>;
}

/**
 * Totals now cover the envelope as well as the content, so they had to rise
 * by about what the old measurement was missing. The **content** budgets are
 * unchanged: a search pair still gets 128 tokens of query and 640 of
 * candidate. What changed is that the ceiling no longer pretends the
 * question map is free.
 */
export const SEARCH_PAIR_CEILINGS: TokenCeilings = {
  total: 1_700,
  components: { query: 128, candidate: 640 },
};

export const RELATED_PAIR_CEILINGS: TokenCeilings = {
  total: 2_800,
  components: { seeds: 768, candidate: 1_024 },
};

/** Tokens a single label's name may occupy in the question that asks it. */
const LABEL_NAME_TOKEN_BUDGET = 40;

/**
 * A label call is the largest request this feature makes, and the ceiling
 * says so now that it is measured rather than assumed.
 *
 * It has to cover the state — context, a 2,048-token excerpt and the
 * bounded vocabulary — *and* the question map, which is one boolean
 * question per label carrying that label's name and description. At the
 * `SUGGESTION_VOCABULARY_MAX` of 40 that envelope alone measures ~9,700
 * tokens, so the previous 4,400 was not a ceiling a full request could ever
 * have met: it was set against a two-rung rubric that is not sent on this
 * path.
 *
 * This is the number to look at when deciding what enabling the feature
 * costs. It is an upper bound per suggested document, not a typical one —
 * a workspace with five labels measures around a third of it.
 */
export const LABEL_EVALUATION_CEILINGS: TokenCeilings = {
  total: 16_000,
  components: { excerpt: 2_048, vocabulary: 1_536 },
};

/**
 * Upper bound on the tokens a byte-pair tokenizer can produce for this text.
 * Code points, not UTF-16 units, so an emoji counts once and a surrogate
 * pair is never counted twice.
 */
export function conservativeTokenCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * Truncate to at most `maxTokens` under the bound above, cutting on a
 * grapheme boundary so a combining mark or an emoji sequence is never split.
 * Deterministic: the same input and budget always produce the same output.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (conservativeTokenCount(text) <= maxTokens) return text;

  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  if (!segmenter) return [...text].slice(0, maxTokens).join("");

  let out = "";
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const cost = conservativeTokenCount(segment);
    if (used + cost > maxTokens) break;
    out += segment;
    used += cost;
  }
  return out;
}

export interface JevSearchPairInput {
  query: string;
  candidateId: string;
  candidateTitle: string;
  candidateExcerpt: string;
}

export interface JevRelatedPairInput {
  seedPassages: string[];
  candidateId: string;
  candidateTitle: string;
  candidateExcerpt: string;
}

export interface JevLabelInput {
  documentExcerpt: string;
  /** Authorized vocabulary shortlist: id, name and rubric description. */
  vocabulary: { id: string; name: string; description: string | null }[];
  projects: { id: string; name: string; description: string | null }[];
  /**
   * MEASUREMENT HARNESS ONLY. Throwaway branch, never merges.
   *
   * Omitted everywhere in the product, so every real call keeps
   * `LABEL_EVALUATION_CEILINGS` exactly. The cost-measurement arms pass a
   * raised ceiling so `fitWithin` stops halving the excerpt back down to
   * today's 2,048 — raising `components.excerpt` alone does nothing,
   * because the halving loop is driven by `ceilings.total`.
   */
  ceilings?: TokenCeilings;
}

export interface SerializedJevRequest {
  /** The exact body we would send, already inside the ceiling. */
  body: Record<string, unknown>;
  serialized: string;
  tokens: number;
  digest: string;
}

export type JevRequestRejection = { rejected: true; reason: string };

export type JevRequestResult = SerializedJevRequest | JevRequestRejection;

/**
 * A label request, plus the exact entries its question map will be built
 * from.
 *
 * The caller must ask about `askedLabels` and nothing else. That is the
 * whole point of returning it: the envelope charged is measured from this
 * same array, so the request that is measured and the request that goes on
 * the wire cannot drift apart. They already had once — the questions were
 * built from the raw shortlist while the body carried a truncated copy.
 */
export type JevLabelRequestResult =
  | (SerializedJevRequest & {
      askedLabels: readonly {
        id: string;
        name: string;
        description: string | null;
      }[];
    })
  | JevRequestRejection;

export function isJevRequestRejection(
  result: JevRequestResult,
): result is JevRequestRejection {
  return "rejected" in result;
}

/**
 * What the state *is*, not how to score it.
 *
 * These used to describe a 0–3 ordinal — "0 unrelated, 1 mentions it, 2
 * partly answers, 3 directly answers" — which stopped being true when the
 * ordinal question became a ladder of booleans. The prompt was asking for a
 * scale while the questions asked for yes or no, so the two halves of the
 * same request disagreed. The scale now lives only in the rungs, and these
 * strings say what the fields mean.
 */
const SEARCH_CONTEXT =
  "A reader searched for `query`. `candidate` is one document from the results, with its title and an excerpt.";
const RELATED_CONTEXT =
  "`seeds` are passages from the document a reader is looking at. `candidate` is a different document, with its title and an excerpt.";
const LABEL_CONTEXT =
  "`document` is an excerpt of one file. `vocabulary` is the workspace's own set of labels, each with an id, a name and a description.";

function finalize(
  body: Record<string, unknown>,
  ceilings: TokenCeilings,
  envelopeTokens: number,
): JevRequestResult {
  const serialized = JSON.stringify(body);
  // The state, plus everything the transport wraps around it. Counting only
  // the state is what let a relevance call under-report by ~686 tokens.
  //
  // The envelope is passed in rather than derived from a rubric key,
  // because for a label call it is not fixed: the questions are one per
  // label, so the envelope grows with the vocabulary. Charging a rubric's
  // two fixed rungs there under-counted a 30-label request by ~8,300.
  const tokens =
    conservativeTokenCount(serialized) +
    envelopeTokens +
    PROVIDER_FRAMING_TOKEN_ALLOWANCE;

  if (tokens > ceilings.total) {
    // Ids and rubric are fixed overhead: if they alone no longer fit, the
    // request is rejected rather than allowed to borrow an unbounded budget.
    return {
      rejected: true,
      reason: `serialized request is ${tokens} tokens, over the ${ceilings.total} ceiling`,
    };
  }

  return {
    body,
    serialized,
    tokens,
    digest: createHash("sha256").update(serialized).digest("base64url"),
  };
}

/**
 * Bound every field, serialize, measure, and trim the lowest-priority
 * excerpt tail until the whole request fits. JSON syntax is never chopped:
 * only content values shrink, and the body is re-serialized after each step.
 */
function fitWithin(
  ceilings: TokenCeilings,
  build: (excerptBudget: number) => Record<string, unknown>,
  initialExcerptBudget: number,
  envelopeTokens: number,
): JevRequestResult {
  let budget = initialExcerptBudget;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = finalize(build(budget), ceilings, envelopeTokens);
    if (!isJevRequestRejection(result)) return result;
    if (budget <= 0) return result;
    budget = Math.floor(budget / 2);
  }

  return { rejected: true, reason: "request did not fit after trimming" };
}

export function buildJevSearchPairRequest(
  input: JevSearchPairInput,
): JevRequestResult {
  const query = truncateToTokenBudget(
    input.query,
    SEARCH_PAIR_CEILINGS.components.query,
  );

  return fitWithin(
    SEARCH_PAIR_CEILINGS,
    (excerptBudget) => ({
      context: SEARCH_CONTEXT,
      query,
      candidate: {
        id: input.candidateId,
        title: truncateToTokenBudget(input.candidateTitle, 64),
        excerpt: truncateToTokenBudget(input.candidateExcerpt, excerptBudget),
      },
    }),
    SEARCH_PAIR_CEILINGS.components.candidate,
    rubricEnvelopeTokens("relevance"),
  );
}

export function buildJevRelatedPairRequest(
  input: JevRelatedPairInput,
): JevRequestResult {
  // Up to three seed passages share one total, allocated evenly and in a
  // stable order so the same seed always serializes the same way.
  const seeds = input.seedPassages.slice(0, 3);
  const perSeed =
    seeds.length === 0
      ? 0
      : Math.floor(RELATED_PAIR_CEILINGS.components.seeds / seeds.length);
  const boundedSeeds = seeds.map((passage) =>
    truncateToTokenBudget(passage, perSeed),
  );

  return fitWithin(
    RELATED_PAIR_CEILINGS,
    (excerptBudget) => ({
      context: RELATED_CONTEXT,
      seeds: boundedSeeds,
      candidate: {
        id: input.candidateId,
        title: truncateToTokenBudget(input.candidateTitle, 64),
        excerpt: truncateToTokenBudget(input.candidateExcerpt, excerptBudget),
      },
    }),
    RELATED_PAIR_CEILINGS.components.candidate,
    rubricEnvelopeTokens("relatedness"),
  );
}

/**
 * The label list a request will actually ask about.
 *
 * Exported because the *questions* carry these names and descriptions, and
 * the questions are built by the evaluator, not here. Both sides call this,
 * so what is measured is what is sent. It is idempotent: truncating an
 * already-truncated entry to the same budget changes nothing.
 */
export function boundLabelVocabulary(
  entries: readonly { id: string; name: string; description: string | null }[],
  total = entries.length,
): { id: string; name: string; description: string | null }[] {
  const perEntry =
    total === 0
      ? 0
      : Math.floor(LABEL_EVALUATION_CEILINGS.components.vocabulary / total);

  return entries.map((entry) => ({
    id: entry.id,
    name: truncateToTokenBudget(entry.name, LABEL_NAME_TOKEN_BUDGET),
    description: truncateToTokenBudget(
      entry.description ?? "",
      Math.max(0, perEntry - LABEL_NAME_TOKEN_BUDGET),
    ),
  }));
}

/**
 * The document excerpt for a label request, built from a document's chunks.
 *
 * ## Why this is not just `chunks.join`
 *
 * It was, and the waste was invisible while the corpus was Markdown. The
 * budget is `LABEL_EVALUATION_CEILINGS.components.excerpt` — 2,048 — and
 * `fitWithin` only ever *halves* it, never raises it, so the request can
 * never carry more than 2,048 tokens of document. `conservativeTokenCount`
 * counts code points, so 2,048 tokens is at most 2,048 code points.
 *
 * A fully indexed document is up to `FILE_CHUNK_MAX_PER_VERSION` chunks of
 * `FILE_CHUNK_TARGET_CHARS`, so joining them all builds an 800,000
 * character string, walks all of it to count tokens, and then discards
 * 99.7% of it. PDFs are what made that matter: a long document used to be
 * the exception and is now ordinary.
 *
 * ## Why this is safe rather than merely cheaper
 *
 * Keeping any prefix longer than the budget produces a byte-identical
 * request, because the truncation that follows can never reach past it.
 * `EXCERPT_CHUNK_MARGIN` is the multiple of the budget kept, and it is
 * generous precisely so the equivalence does not depend on arithmetic
 * being exactly right. There is a test asserting the two requests are
 * identical for a document far past the cap.
 */
const EXCERPT_CHUNK_MARGIN = 4;

export function labelExcerptFromChunks(chunks: { text: string }[]): string {
  const keepChars =
    LABEL_EVALUATION_CEILINGS.components.excerpt * EXCERPT_CHUNK_MARGIN;

  const kept: string[] = [];
  let length = 0;
  for (const chunk of chunks) {
    kept.push(chunk.text);
    length += chunk.text.length + 2;
    if (length >= keepChars) break;
  }

  return kept.join("\n\n");
}

export function buildJevLabelRequest(
  input: JevLabelInput,
): JevLabelRequestResult {
  const ceilings = input.ceilings ?? LABEL_EVALUATION_CEILINGS;
  const total = input.vocabulary.length + input.projects.length;
  const vocabulary = boundLabelVocabulary(input.vocabulary, total);
  const projects = boundLabelVocabulary(input.projects, total);

  /**
   * Everything the question map will ask about.
   *
   * Projects ride in the state today and are not asked as questions, so
   * they are not in here. **If that changes, add them to this array and
   * nothing else needs to change** — the envelope below is measured from
   * it, and the caller asks from it. An envelope computed from a separate
   * expression is how the label call came to be under-counted by ~8,300
   * tokens in the first place; a parameter that is only safe because
   * nobody passes it yet is the same bug waiting for a date.
   */
  const askedLabels = vocabulary;

  const result = fitWithin(
    ceilings,
    (excerptBudget) => ({
      context: LABEL_CONTEXT,
      document: truncateToTokenBudget(input.documentExcerpt, excerptBudget),
      vocabulary,
      projects,
    }),
    ceilings.components.excerpt,
    // The real envelope: one boolean question per asked entry, each
    // carrying that entry's name and description. `RUBRICS.belongs` is
    // never sent on this path, so charging its two fixed rungs measured a
    // request that does not exist.
    labelEnvelopeTokens(askedLabels),
  );

  if (isJevRequestRejection(result)) return result;
  return { ...result, askedLabels };
}
