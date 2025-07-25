import { ConfirmedEvent, OptimisticEvent } from "@ably-labs/models";

import { JobStatusData, jobStatusDataSchema } from "./job-status";

export function mergeJobStatus(
  existingState: JobStatusData,
  event: OptimisticEvent | ConfirmedEvent,
): JobStatusData {
  // Optimistic and confirmed events use the same merge function logic.

  // The models function keeps track of the state before events are applied
  // to make sure the rollback of unconfirmed events works, we need to clone
  // the state here. Our state contains an array of objects so we don't use
  // the regular object spread operator.

  const parsedResult = jobStatusDataSchema.safeParse(event.data);
  if (!parsedResult.success) {
    console.error("Invalid Job Status Update", parsedResult.error);
    return existingState;
  }

  const jobStatusData = parsedResult.data;
  return jobStatusData;
}
