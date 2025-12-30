import {
  type JobWithCreditTransaction,
  type JobWithEvents,
  type JobWithPurchase,
} from "@sokosumi/database";
import {
  computeJobStatus,
  getCompletedAt,
  getCredits,
  getInput,
  getInputHash,
  getInputSchema,
  getResult,
  getResultHash,
} from "@sokosumi/database/helpers";

export function flattenJob(
  job: JobWithEvents & JobWithCreditTransaction & JobWithPurchase,
) {
  return {
    ...job,
    completedAt: getCompletedAt(job),
    result: getResult(job),
    resultHash: getResultHash(job),
    input: getInput(job),
    inputSchema: getInputSchema(job),
    inputHash: getInputHash(job),
    credits: getCredits(job),
    status: computeJobStatus(job),
  };
}
