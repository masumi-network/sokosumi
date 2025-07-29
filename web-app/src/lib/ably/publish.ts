import "server-only";

import getClient from "./client";
import { JobStatusData } from "./schema";
import { getAgentJobsChannelName, makeAgentJobsChannel } from "./utils";

export default async function publishJobStatusData(
  jobStatusData: JobStatusData,
  userId: string,
) {
  const client = getClient();
  const channel = client.channels.get(
    makeAgentJobsChannel(jobStatusData.id, userId),
  );
  await channel.publish(getAgentJobsChannelName(), jobStatusData);
}
