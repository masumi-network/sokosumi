import { TaskX402PaymentStatus } from "@sokosumi/database";

/** Payment states whose Task relation can be removed without losing live money. */
export const SWEEPABLE_X402_STATUSES = [
  TaskX402PaymentStatus.VERIFIED,
  TaskX402PaymentStatus.FAILED,
  TaskX402PaymentStatus.REFUNDED,
];
