import "server-only";

import { JobWithSokosumiStatus } from "@sokosumi/database";

import { getJobStatusData } from "@/lib/helpers/job";

import { getRestClient } from "./client";
import { makeAgentJobsChannelName } from "./utils";

export default async function publishJobStatusData(job: JobWithSokosumiStatus) {
  const client = getRestClient();
  const channel = client.channels.get(
    makeAgentJobsChannelName(job.agentId, job.userId),
  );
  await channel.publish("job_status_data", getJobStatusData(job));
}
