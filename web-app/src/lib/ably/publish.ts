import "server-only";

import getClient from "./client";
import { JobStatusData } from "./schema";
import { makeJobStatusChannel } from "./utils";

export default async function publishJobStatusData(
  jobStatusData: JobStatusData,
) {
  const client = getClient();
  const channel = client.channels.get(makeJobStatusChannel(jobStatusData.id));
  await channel.publish("job_status_update", jobStatusData);
}
