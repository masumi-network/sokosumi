import "server-only";

import { Realtime } from "ably";

import { getEnvSecrets } from "@/config/env.secrets";

import { JobStatusData } from "./schema";
import { makeJobStatusChannel } from "./utils";

let client: Realtime;

function getClient() {
  if (!client) {
    client = new Realtime({
      key: getEnvSecrets().ABLY_JOB_PUBLISH_ONLY_KEY,
    });
  }
  return client;
}

export async function publishJobStatusData(jobStatusData: JobStatusData) {
  const client = getClient();
  const channel = client.channels.get(makeJobStatusChannel(jobStatusData.id));
  await channel.publish("job_status_update", jobStatusData);
}
