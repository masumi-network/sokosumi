import { makeJobStatusChannelName } from "@sokosumi/utils";

import { getRealtimeChannelEnvironment } from "./realtime-channel-environment";

// Web shows Mainnet's Jobs only, until it names a Network per request.
const JOB_STATUS_NETWORK = "mainnet";

/**
 * The channel that carries the status of every Job the user owns in one
 * Workspace, whatever its Agent: a subscriber ignores the Jobs it does not
 * show.
 */
export function jobStatusChannelName(
  workspaceId: string,
  userId: string,
): string {
  return makeJobStatusChannelName(
    JOB_STATUS_NETWORK,
    workspaceId,
    userId,
    getRealtimeChannelEnvironment(),
  );
}
