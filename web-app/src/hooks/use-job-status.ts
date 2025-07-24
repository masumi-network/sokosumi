"use client";

import ModelsClient, { Model, SyncReturnType } from "@ably-labs/models";
import { useAbly } from "ably/react";
import { useEffect, useMemo, useState } from "react";

import { makeJobStatusChannel, mergeJobStatus } from "@/lib/ably";
import { JobStatus } from "@/lib/db";

export type ModelType = Model<(jobId: string) => SyncReturnType<JobStatus>>;

export default function useJobStatus(jobId: string) {
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
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
        const response = await fetch(`/api/job/status-sync?jobId=${jobId}`);
        const result = (await response.json()) as {
          jobStatus: JobStatus;
          sequenceId: number;
        };
        return {
          data: result.jobStatus,
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

    const subscribe = (err: Error | null, data: JobStatus | undefined) => {
      if (err) return console.error(err);
      setJobStatus(data ?? null);
    };

    model.subscribe(subscribe);

    return () => {
      model.unsubscribe(subscribe);
    };
  }, [model]);

  return { jobStatus, model };
}
