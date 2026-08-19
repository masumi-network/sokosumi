"use client";

import { Briefcase, Loader2 } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { unassignedWorkspaceJobsQuery } from "@/app/projects/constants";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { coreClient } from "@/lib/clients/core.browser.client";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import type {
  GetJobsResponse,
  JobSummary,
} from "@/lib/clients/generated/core/types.gen";

const JOB_PICKER_PAGE_SIZE = 50;

interface ProjectJobPickerDialogLabels {
  pickerTitle: string;
  pickerDescription: string;
  pickerSearchPlaceholder: string;
  pickerEmpty: string;
  pickerLoading: string;
  pickerError: string;
  untitled: string;
}

interface ProjectJobPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdding: boolean;
  pendingJobId: string | null;
  onSelectJob: (jobId: string) => void;
  labels: ProjectJobPickerDialogLabels;
}

export function ProjectJobPickerDialog({
  open,
  onOpenChange,
  isAdding,
  pendingJobId,
  onSelectJob,
  labels,
}: ProjectJobPickerDialogProps) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadJobs = useEffectEvent(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = (await coreClient.getJobs(
        unassignedWorkspaceJobsQuery({ limit: JOB_PICKER_PAGE_SIZE }),
      )) as GetJobsResponse;

      if (requestId !== requestIdRef.current) return;

      setJobs(response.data);
    } catch {
      if (requestId !== requestIdRef.current) return;

      setJobs([]);
      setError(labels.pickerError);
    } finally {
      if (requestId !== requestIdRef.current) return;

      setIsLoading(false);
    }
  });

  useEffect(() => {
    if (!open) return;

    void loadJobs();
  }, [loadJobs, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setJobs([]);
      setError(null);
      setIsLoading(false);
      requestIdRef.current += 1;
    }

    onOpenChange(nextOpen);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={labels.pickerTitle}
      description={labels.pickerDescription}
    >
      <CommandInput placeholder={labels.pickerSearchPlaceholder} />
      <CommandList>
        {isLoading && jobs.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.pickerLoading}
          </div>
        ) : null}

        {!isLoading && error && jobs.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && jobs.length === 0 ? (
          <CommandEmpty>{labels.pickerEmpty}</CommandEmpty>
        ) : null}

        {jobs.length > 0 ? (
          <CommandGroup heading={labels.pickerTitle}>
            {jobs.map((job) => {
              const name = job.name?.trim() ? job.name : labels.untitled;

              return (
                <CommandItem
                  key={job.id}
                  value={`${name} ${job.id}`}
                  disabled={isAdding}
                  onSelect={() => onSelectJob(job.id)}
                >
                  {isAdding && pendingJobId === job.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Briefcase className="size-4" aria-hidden />
                  )}
                  <span className="truncate">{name}</span>
                  <JobStatusBadge
                    status={job.status as SokosumiJobStatus}
                    className="ml-auto"
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
