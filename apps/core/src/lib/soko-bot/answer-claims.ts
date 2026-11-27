import { AsyncLocalStorage } from "node:async_hooks";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { askJev } from "./jev";

/** A long report (a weekly wrap, a stand-up) takes Jev several seconds. */
const TIMEOUT_MS = 12_000;
const MAX_TEXT_LENGTH = 8_000;
/** Below this the text is shown; Jev is sure about plain reports and questions. */
const MAX_CLAIM_PROBABILITY = 0.5;

const CLAIMS_ACTION =
  "The text is an assistant's reply to its owner. confirmedChanges lists the changes its tools confirmed in this turn. Does the reply say the assistant has already changed something in Sokosumi or for other people that is not in confirmedChanges: created, assigned, updated or archived a Task, sent or posted a message or email, scheduled a check-in or reminder, changed a calendar, uploaded to Drive, hired an Agent, generated an image, or changed its memory? Reporting a change that is in confirmedChanges is fine. Only count changes the reply says the assistant itself made. Offers, plans, questions, research findings, calculations, files in the assistant's own private workspace, and work it reports from Tasks, Coworkers, other people or earlier days (what was implemented, completed or merged) do not count.";

const MAX_SENTENCE_BATCH = 20;
/** Hard cap on added Jev calls while pruning a rejected owner reply. */
export const CLAIM_PRUNE_MAX_CALLS = 3;
/** Shared wall-clock budget across sentence batches, clause rescue, and rechecks. */
export const CLAIM_PRUNE_BUDGET_MS = 12_000;

export interface ClaimCheckBudget {
  readonly deadlineAt: number;
  remainingCalls: number;
}

const activeClaimBudget = new AsyncLocalStorage<ClaimCheckBudget>();

export function createClaimCheckBudget(
  maxCalls = CLAIM_PRUNE_MAX_CALLS,
  budgetMs = CLAIM_PRUNE_BUDGET_MS,
  now = Date.now(),
): ClaimCheckBudget {
  return {
    deadlineAt: now + budgetMs,
    remainingCalls: Math.max(0, maxCalls),
  };
}

/**
 * Runs a pruning pass (sentence batches, clause rescue, rechecks) under one
 * shared call cap and wall-clock deadline without changing `claimsAction`'s
 * two-argument call contract.
 */
export function withClaimCheckBudget<T>(
  fn: (budget: ClaimCheckBudget) => Promise<T>,
  budget = createClaimCheckBudget(),
): Promise<T> {
  return activeClaimBudget.run(budget, () => fn(budget));
}

function consumeClaimBudget(budget: ClaimCheckBudget): number | null {
  if (budget.remainingCalls <= 0) return null;
  const remainingMs = budget.deadlineAt - Date.now();
  if (remainingMs <= 0) return null;
  budget.remainingCalls -= 1;
  return Math.min(TIMEOUT_MS, remainingMs);
}

const SENTENCE_CLAIMS_ACTION =
  "confirmedChanges lists the changes the assistant's tools confirmed in this turn. Does ONLY this single sentence (in sentences[key]) say the assistant has already changed something in Sokosumi or for other people that is not in confirmedChanges (such as creating/updating/archiving a Task, sending/posting a message or email, scheduling a post or reminder, publishing live, changing a calendar, uploading to Drive, hiring an Agent, generating an image, or changing memory)? Reporting a change that IS in confirmedChanges is fine. Offers, proposals labeled as suggestions, plans, questions, research findings, calculations, waiting-for-approval notes, and work done by others do not count.";

/**
 * Whether the bot's own words claim an action its receipts do not show.
 * Actions are shown from verified receipts, so such a reply is not shown;
 * one that reports the confirmed changes is. Null when the check failed,
 * returned no answer, or exhausted a shared pruning budget.
 */
export async function claimsAction(
  text: string,
  confirmedChanges: readonly string[] = [],
  budget: ClaimCheckBudget | undefined = activeClaimBudget.getStore(),
): Promise<boolean | null> {
  if (budget) {
    const timeoutMs = consumeClaimBudget(budget);
    if (timeoutMs === null) return null;
    return askClaimsOnce(text, confirmedChanges, CLAIMS_ACTION, timeoutMs);
  }
  return askClaims(text, confirmedChanges, CLAIMS_ACTION);
}

/**
 * Scores each sentence independently against `confirmedChanges` in batched Jev
 * calls bounded by a shared call cap and wall-clock deadline so the claim
 * check can drop only unsupported sentences without unbounded latency.
 */
export async function claimsActionBySentence(
  sentences: readonly string[],
  confirmedChanges: readonly string[] = [],
  budget: ClaimCheckBudget = activeClaimBudget.getStore() ??
    createClaimCheckBudget(),
): Promise<(boolean | null)[]> {
  if (sentences.length === 0) return [];
  const results: (boolean | null)[] = new Array(sentences.length).fill(null);
  for (
    let offset = 0;
    offset < sentences.length;
    offset += MAX_SENTENCE_BATCH
  ) {
    const timeoutMs = consumeClaimBudget(budget);
    if (timeoutMs === null) break;
    const batch = sentences.slice(offset, offset + MAX_SENTENCE_BATCH);
    const first = await askSentenceBatchOnce(
      batch,
      confirmedChanges,
      timeoutMs,
    );
    let sawAnswer = false;
    const missing: number[] = [];
    for (let i = 0; i < batch.length; i++) {
      const verdict = first[i] ?? null;
      results[offset + i] = verdict;
      if (verdict === null) missing.push(i);
      else sawAnswer = true;
    }
    // If Jev returned zero answers for the whole batch (outage / empty reply),
    // stop immediately rather than burning remaining budget on later batches.
    if (!sawAnswer) break;
    const isLastBatch = offset + MAX_SENTENCE_BATCH >= sentences.length;
    if (isLastBatch && missing.length > 0) {
      const retryTimeoutMs = consumeClaimBudget(budget);
      if (retryTimeoutMs !== null) {
        const retried = await askSentenceBatchOnce(
          missing.map((index) => batch[index] ?? ""),
          confirmedChanges,
          retryTimeoutMs,
        );
        missing.forEach((index, pos) => {
          results[offset + index] = retried[pos] ?? null;
        });
      }
    }
  }
  return results;
}

async function askSentenceBatchOnce(
  sentences: readonly string[],
  confirmedChanges: readonly string[],
  timeoutMs: number,
): Promise<(boolean | null)[]> {
  const keyedSentences: Record<string, string> = {};
  const questions: Record<string, string> = {};
  for (let i = 0; i < sentences.length; i++) {
    const key = `s${i}`;
    keyedSentences[key] = (sentences[i] ?? "").slice(0, MAX_TEXT_LENGTH);
    questions[key] =
      `Evaluate sentences.${key} alone: ${SENTENCE_CLAIMS_ACTION}`;
  }
  try {
    const answers = await askJev({
      state: {
        sentences: keyedSentences,
        confirmedChanges: [...confirmedChanges],
      },
      questions,
      timeoutMs,
    });
    return sentences.map((_, i) => {
      const probability = answers.get(`s${i}`);
      return probability === undefined
        ? null
        : probability >= MAX_CLAIM_PROBABILITY;
    });
  } catch (error) {
    recordCoreWarning(
      { operation: "soko_bot_claim_check" },
      {
        message: "Could not check a Soko Bot reply for unconfirmed claims",
        why: "Jev, the judging model, failed or timed out",
        fix: "Nothing: Core asks once more, then shows the reply with a note that it could not be checked.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    return sentences.map(() => null);
  }
}

const STANDUP_CLAIMS =
  "The text is an assistant's update in its team's daily stand-up. confirmedChanges is its record since the last stand-up: what it did, what it handed out that is running, what is open, what waits on whom, and what the Coworkers (other AI agents) on its person's Tasks finished or are still on. Does the update say the assistant did, made, sent, posted, finished, is working on or is waiting on something that is not in confirmedChanges, or give a number, name or Task the record does not have? Shortened, reworded or translated Task names and counts that match the record are fine, and so is saying a Coworker or Task waits on the person the record names. Saying it finished nothing, or what it plans next from the open items, is fine.";

/** Whether a stand-up update claims work its record does not show; null when the check failed. */
export async function standupClaimsUnrecordedWork(
  text: string,
  record: readonly string[],
): Promise<boolean | null> {
  return askClaims(text, record, STANDUP_CLAIMS);
}

/** One retry: a single slow or failed Jev call left a whole reply unchecked. */
async function askClaims(
  text: string,
  confirmedChanges: readonly string[],
  question: string,
): Promise<boolean | null> {
  return (
    (await askClaimsOnce(text, confirmedChanges, question)) ??
    askClaimsOnce(text, confirmedChanges, question)
  );
}

async function askClaimsOnce(
  text: string,
  confirmedChanges: readonly string[],
  question: string,
  timeoutMs = TIMEOUT_MS,
): Promise<boolean | null> {
  try {
    const answers = await askJev({
      state: {
        reply: text.slice(0, MAX_TEXT_LENGTH),
        confirmedChanges: [...confirmedChanges],
      },
      questions: { claimsAction: question },
      timeoutMs,
    });
    const probability = answers.get("claimsAction");
    return probability === undefined
      ? null
      : probability >= MAX_CLAIM_PROBABILITY;
  } catch (error) {
    // Only safe fields: a model error can quote the text it was sent.
    recordCoreWarning(
      { operation: "soko_bot_claim_check" },
      {
        message: "Could not check a Soko Bot reply for unconfirmed claims",
        why: "Jev, the judging model, failed or timed out",
        fix: "Nothing: Core asks once more, then shows the reply with a note that it could not be checked.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    return null;
  }
}
