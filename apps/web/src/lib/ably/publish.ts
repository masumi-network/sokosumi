import "server-only";

import { getJobIndicatorStatus } from "@/lib/db";
import { Job } from "@/prisma/generated/client";

import { getRestClient } from "./client";
import { getAgentJobsChannelName, makeAgentJobsChannel } from "./utils";

export default async function publishJobStatusData(job: Job) {
  const client = getRestClient();
  const channel = client.channels.get(
    makeAgentJobsChannel(job.agentId, job.userId),
  );
  await channel.publish(getAgentJobsChannelName(), getJobIndicatorStatus(job));
}
