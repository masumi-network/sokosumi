import { SokosumiJobStatus } from "@/lib/clients/generated/core";

export function getJobStatusBadgeLabelKey(status: SokosumiJobStatus) {
  switch (status) {
    case SokosumiJobStatus.COMPLETED:
      return "completed";
    case SokosumiJobStatus.FAILED:
      return "failed";
    case SokosumiJobStatus.PAYMENT_FAILED:
      return "paymentFailed";
    // Two statuses, two labels. Both printing "paymentPending" put two badges
    // and two status filter options on screen reading the same word, with no
    // way to tell which one a job was actually in.
    case SokosumiJobStatus.STARTED:
      return "started";
    case SokosumiJobStatus.PAYMENT_PENDING:
      return "paymentPending";
    case SokosumiJobStatus.PROCESSING:
      return "processing";
    case SokosumiJobStatus.INPUT_REQUIRED:
      return "inputRequired";
    case SokosumiJobStatus.REFUND_PENDING:
      return "refundRequested";
    case SokosumiJobStatus.REFUND_RESOLVED:
      return "refundResolved";
    case SokosumiJobStatus.DISPUTE_PENDING:
      return "disputeRequested";
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      return "disputeResolved";
    case SokosumiJobStatus.RESULT_PENDING:
      return "resultPending";
    default:
      return "unknown";
  }
}
