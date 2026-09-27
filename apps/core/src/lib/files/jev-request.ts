import { createHash } from "node:crypto";

import {
  type JevRubricKey,
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
 * authorized to make, so `FILES_JEV_ENABLED` stays off by default — but the
 * ceiling it would be reconciled against is now the whole request.
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

export const LABEL_EVALUATION_CEILINGS: TokenCeilings = {
  total: 4_400,
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
  rubric: JevRubricKey,
): JevRequestResult {
  const serialized = JSON.stringify(body);
  // The state, plus everything the transport wraps around it. Counting only
  // the state is what let a relevance call under-report by ~686 tokens.
  const tokens =
    conservativeTokenCount(serialized) +
    rubricEnvelopeTokens(rubric) +
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
  rubric: JevRubricKey,
): JevRequestResult {
  let budget = initialExcerptBudget;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = finalize(build(budget), ceilings, rubric);
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
    "relevance",
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
    "relatedness",
  );
}

export function buildJevLabelRequest(input: JevLabelInput): JevRequestResult {
  const vocabularyBudget = LABEL_EVALUATION_CEILINGS.components.vocabulary;
  const perEntry =
    input.vocabulary.length + input.projects.length === 0
      ? 0
      : Math.floor(
          vocabularyBudget / (input.vocabulary.length + input.projects.length),
        );

  const vocabulary = input.vocabulary.map((entry) => ({
    id: entry.id,
    name: truncateToTokenBudget(entry.name, 40),
    description: truncateToTokenBudget(
      entry.description ?? "",
      Math.max(0, perEntry - 40),
    ),
  }));
  const projects = input.projects.map((entry) => ({
    id: entry.id,
    name: truncateToTokenBudget(entry.name, 40),
    description: truncateToTokenBudget(
      entry.description ?? "",
      Math.max(0, perEntry - 40),
    ),
  }));

  return fitWithin(
    LABEL_EVALUATION_CEILINGS,
    (excerptBudget) => ({
      context: LABEL_CONTEXT,
      document: truncateToTokenBudget(input.documentExcerpt, excerptBudget),
      vocabulary,
      projects,
    }),
    LABEL_EVALUATION_CEILINGS.components.excerpt,
    "belongs",
  );
}
