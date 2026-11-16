import { applyDecision } from "./decision-apply";
import { prepareDecision } from "./decision-claim";
import { type RuntimeOperations } from "./operations";

export async function resolveDecision(
  runtime: RuntimeOperations,
  /** Null only when the bot accepts its own card in a turn for nobody. */
  resolverUserId: string | null,
  decisionId: string,
  accepted: boolean,
  ownerConfirmed = true,
  confirmationTurnId?: string,
) {
  const prepared = await prepareDecision(
    runtime,
    resolverUserId,
    decisionId,
    accepted,
    ownerConfirmed,
    confirmationTurnId,
  );
  if (prepared.done) return prepared.result;
  return applyDecision(runtime, prepared);
}
