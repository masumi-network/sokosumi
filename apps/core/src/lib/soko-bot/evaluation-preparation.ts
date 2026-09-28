import { createHash } from "node:crypto";
import {
  composeSystemPrompt,
  SOKO_BOT_CAPABILITIES,
  type SokoBotVersion,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import {
  SOKO_BOT_MODEL_POLICY_VERSION,
  sokoBotModelRequest,
} from "./model-policy";

export const SOKO_BOT_ARCHIVE_GUIDANCE =
  "Owner-requested task archival: use archive_task only for an explicit request identifying one eligible owned task. An explicit owner request to archive now is authorization; do not demand redundant confirmation. Read it first and pass exact updatedAt as expectedUpdatedAt. Ask which task when names are ambiguous. Archival hides the task from the normal board and retains history; it does not cancel work or permanently delete data. Never change status or remove an active schedule to bypass an archive rejection. Cite a verified committed receipt before saying it was archived.";
export const SOKO_BOT_ARCHIVE_APPROVAL_GUIDANCE =
  "When the owner asks to propose archival and wait for approval, persist request_user_decision with toolName archive_task and the exact taskId/expectedUpdatedAt proposal. Do not archive before approval. An ordinary conversational offer is not a durable proposal or an approval.";

/** Materialize inherited prompts and skill content before hashing. Never register
 * or promote these local candidates: review and paid comparison happen separately.
 */
export function createSokoBotCandidate(base: SokoBotVersion, model: string) {
  sokoBotModelRequest({ role: "agent", model });
  const capabilities = [...(base.capabilities ?? SOKO_BOT_CAPABILITIES)].sort();
  const definition = {
    baseVersionId: base.id,
    policyVersion: SOKO_BOT_MODEL_POLICY_VERSION,
    model,
    inferenceRegion: "eu" as const,
    systemPrompt: [
      composeSystemPrompt(base),
      ...(capabilities.includes("archive_task")
        ? [SOKO_BOT_ARCHIVE_GUIDANCE]
        : []),
      ...(capabilities.includes("archive_task") &&
      capabilities.includes("request_user_decision")
        ? [SOKO_BOT_ARCHIVE_APPROVAL_GUIDANCE]
        : []),
    ].join("\n\n"),
    capabilities,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(definition))
    .digest("hex");
  if (definition.capabilities) Object.freeze(definition.capabilities);
  return Object.freeze({ id: `candidate-${digest}`, ...definition });
}

const sanitizedText = z
  .string()
  .min(1)
  .max(12_000)
  .refine(
    (text) =>
      !/(?:https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:sk-|Bearer\s|postgres(?:ql)?:))/i.test(
        text,
      ),
    "Replace addresses, links and credentials with synthetic placeholders",
  );
export const sokoBotEvaluationCasesSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^case-[a-z0-9-]{1,60}$/),
        conversation: z.string().regex(/^conversation-[a-z0-9-]{1,60}$/),
        split: z.enum(["development", "held-out"]),
        sanitized: z.literal(true),
        message: sanitizedText,
        expected: sanitizedText,
      })
      .strict(),
  )
  .min(1)
  .max(500)
  .superRefine((cases, context) => {
    const splits = new Map<string, string>();
    const ids = new Set<string>();
    for (const item of cases) {
      if (
        ids.has(item.id) ||
        (splits.has(item.conversation) &&
          splits.get(item.conversation) !== item.split)
      ) {
        context.addIssue({
          code: "custom",
          message: "Duplicate case or conversation split leakage",
        });
      }
      ids.add(item.id);
      splits.set(item.conversation, item.split);
    }
  });

/** Offline reservation ledger. Missing actual cost retains the whole reservation.
 * Bounds include retries: every attempt must reserve separately, before dispatch.
 * No SDK, database, provider credentials or network execution belongs here.
 */
export class SokoBotEvaluationBudget {
  private requests = 0;
  private chargedUsd = 0;
  private readonly reservations = new Map<number, number>();

  reserve(options: {
    inputTokens: number;
    outputTokens: number;
    maximumCostUsd: number;
  }) {
    if (
      !Number.isSafeInteger(options.inputTokens) ||
      options.inputTokens < 1 ||
      options.inputTokens > 8_192 ||
      !Number.isSafeInteger(options.outputTokens) ||
      options.outputTokens < 1 ||
      options.outputTokens > 2_048 ||
      !Number.isFinite(options.maximumCostUsd) ||
      options.maximumCostUsd <= 0 ||
      this.requests >= 100 ||
      this.totalUsd + options.maximumCostUsd > 10
    ) {
      throw new RangeError(
        "Evaluation request exceeds the approved preparation limits",
      );
    }
    this.requests += 1;
    this.reservations.set(this.requests, options.maximumCostUsd);
    return this.requests;
  }

  settle(request: number, actualCostUsd: number | null) {
    const reserved = this.reservations.get(request);
    if (reserved === undefined)
      throw new RangeError("Unknown or settled evaluation request");
    if (actualCostUsd === null) return;
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0)
      throw new RangeError("Invalid evaluation cost");
    this.reservations.delete(request);
    this.chargedUsd += actualCostUsd;
    if (actualCostUsd > reserved) {
      // Freeze further dispatch after pricing assumptions were invalidated.
      this.requests = 100;
      throw new RangeError("Actual evaluation cost exceeded its reservation");
    }
  }

  get totalUsd() {
    return (
      this.chargedUsd +
      [...this.reservations.values()].reduce((sum, amount) => sum + amount, 0)
    );
  }
}
