import { createCoreLogger } from "@/lib/evlog";

export class SokoBotReconciliationLeaseLostError extends Error {
  override readonly name = "SokoBotReconciliationLeaseLostError";
}

export function reportSokoBotReconciliationLeaseLoss(
  turnId: string,
  error: unknown,
): boolean {
  if (!(error instanceof SokoBotReconciliationLeaseLostError)) return false;
  createCoreLogger({
    operation: "soko_bot_turn_reconcile",
    turn: { id: turnId },
    outcome: "lease_lost",
  }).emit();
  return true;
}
