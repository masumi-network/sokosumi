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
  'Archiving: when the owner asks you to archive Tasks, archive them with archive_task; several in one turn is fine, and "all my X tasks" means finding them with list_tasks and archiving each. Ask in chat only when it is unclear which Tasks they mean. Read each Task first and pass its exact updatedAt. Archiving hides a Task from the board and keeps its history; it does not cancel work. A Task that is running or waiting for input cannot be archived as it is: when the owner wants it gone, cancel it with reply_to_task status CANCELED, the comment saying why, then archive it. Say a Task was archived only after archive_task succeeded.';

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
