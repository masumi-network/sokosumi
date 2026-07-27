interface TaskEventChargePresentationInput {
  comment?: string | null;
  status?: string | null;
  credits?: number | null;
  transactionId?: string | null;
}

export type TaskEventChargeActionKind =
  | "commented"
  | "updatedStatus"
  | "charged";

export interface TaskEventChargePresentation {
  hasComment: boolean;
  hasCharge: boolean;
  isAttemptedCharge: boolean;
  actionKind: TaskEventChargeActionKind;
  shouldShowSecondaryChargeLine: boolean;
}

/**
 * Shared action / charge-line rules for authenticated task activity and
 * public shared-task timelines.
 */
export function getTaskEventChargePresentation(
  event: TaskEventChargePresentationInput,
): TaskEventChargePresentation {
  const hasComment = Boolean(event.comment?.trim());
  const hasStatus = event.status != null;
  const hasCharge = event.credits != null;
  const isAttemptedCharge = hasCharge && event.transactionId == null;

  const actionKind: TaskEventChargeActionKind = hasComment
    ? "commented"
    : hasStatus
      ? "updatedStatus"
      : hasCharge
        ? "charged"
        : "updatedStatus";

  return {
    hasComment,
    hasCharge,
    isAttemptedCharge,
    actionKind,
    shouldShowSecondaryChargeLine: hasCharge && (hasComment || hasStatus),
  };
}
