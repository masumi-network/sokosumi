"use client";

import ModelsClient, { Model, SyncReturnType } from "@ably-labs/models";
import { useAbly } from "ably/react";
import { useEffect, useMemo, useState } from "react";

import {
  JobStatusData,
  makeJobStatusChannel,
  mergeJobStatus,
} from "@/lib/ably";

export type ModelType = Model<(jobId: string) => SyncReturnType<JobStatusData>>;

export default function useJobStatus(jobId: string) {
  const [jobStatusData, setJobStatusData] = useState<JobStatusData | null>(
    null,
  );
  const [model, setModel] = useState<ModelType>();
  const realtimeClient = useAbly();
  const modelsClient = useMemo(
    () => new ModelsClient({ ably: realtimeClient }),
    [realtimeClient],
  );

  useEffect(() => {
    if (!jobId) return;

    const model: ModelType = modelsClient.models.get({
      channelName: makeJobStatusChannel(jobId),
      sync: async (data) => {
        console.log("sync", data);
        const response = await fetch(`/api/job/status-data?jobId=${jobId}`);
        if (!response.ok) {
          throw new Error("Failed to get job status");
        }
        const result = (await response.json()) as {
          jobStatusData: JobStatusData;
          sequenceId: number;
        };
        return {
          data: result.jobStatusData,
          sequenceId: result.sequenceId,
        };
      },
      merge: mergeJobStatus,
    });

    setModel(model);
  }, [jobId, modelsClient]);

  useEffect(() => {
    if (!jobId || !model) return;

    const getJobStatus = async (jobId: string) => {
      await model.sync(jobId);
    };
    getJobStatus(jobId);
  }, [jobId, model]);

  useEffect(() => {
    if (!model) return;

    const subscribe = (err: Error | null, data: JobStatusData | undefined) => {
      if (err) return console.error(err);
      setJobStatusData(data ?? null);
    };

    model.subscribe(subscribe);

    return () => {
      model.unsubscribe(subscribe);
    };
  }, [model]);

  return { data: jobStatusData, model };
}
