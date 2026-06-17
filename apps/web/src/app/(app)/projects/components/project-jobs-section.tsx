"use client";

import { SokosumiJobStatus } from "@sokosumi/utils";
import { Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ProjectJobPickerDialog } from "@/app/projects/components/project-job-picker-dialog";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { addProjectJob, removeProjectJob } from "@/lib/actions/project/action";
import type { JobSummary } from "@/lib/clients/generated/core/types.gen";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface ProjectJobsSectionLabels {
  title: string;
  empty: string;
  add: string;
  remove: string;
  pickerTitle: string;
  pickerDescription: string;
  pickerSearchPlaceholder: string;
  pickerEmpty: string;
  pickerLoading: string;
  pickerError: string;
  confirmRemove: string;
  cancel: string;
  untitled: string;
  errors: {
    add: string;
    remove: string;
  };
}

interface ProjectJobsSectionProps {
  projectId: string;
  jobs: JobSummary[];
  labels: ProjectJobsSectionLabels;
}

export function ProjectJobsSection({
  projectId,
  jobs,
  labels,
}: ProjectJobsSectionProps) {
  const router = useRouter();
  const { formatTimeAgo } = useLocalizedDateTime();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [jobToRemove, setJobToRemove] = useState<JobSummary | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [isAdding, startAddTransition] = useTransition();
  const [isRemoving, startRemoveTransition] = useTransition();

  const sortedJobs = [...jobs].sort(
    (firstJob, secondJob) =>
      new Date(secondJob.createdAt).getTime() -
      new Date(firstJob.createdAt).getTime(),
  );

  function handleSelectJob(jobId: string) {
    setPendingJobId(jobId);

    startAddTransition(async () => {
      try {
        await addProjectJob({ projectId, jobId });
        setIsPickerOpen(false);
        router.refresh();
      } catch {
        toast.error(labels.errors.add);
      } finally {
        setPendingJobId(null);
      }
    });
  }

  function handleRemoveJob() {
    if (!jobToRemove) return;

    const jobId = jobToRemove.id;
    setPendingJobId(jobId);

    startRemoveTransition(async () => {
      try {
        await removeProjectJob({ projectId, jobId });
        setJobToRemove(null);
        router.refresh();
      } catch {
        toast.error(labels.errors.remove);
      } finally {
        setPendingJobId(null);
      }
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground/60 text-xs font-medium">
          {labels.title}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsPickerOpen(true)}
        >
          <Plus className="size-4" aria-hidden />
          {labels.add}
        </Button>
      </div>

      {sortedJobs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{labels.empty}</p>
      ) : (
        <ul className="space-y-3">
          {sortedJobs.map((job) => {
            const name = job.name?.trim() ? job.name : labels.untitled;

            return (
              <li
                key={job.id}
                className="bg-muted/40 border-border/50 flex items-center gap-2 rounded-lg border p-3"
              >
                <Link
                  href={`/agents/${job.agentId}/jobs/${job.id}`}
                  className="hover:text-primary grid min-w-0 flex-1 gap-2 transition-colors sm:grid-cols-[minmax(0,1fr)_140px_96px] sm:items-center"
                >
                  <p className="truncate text-sm">{name}</p>
                  <JobStatusBadge
                    status={job.status as SokosumiJobStatus}
                    className="shrink-0"
                  />
                  <p className="text-muted-foreground shrink-0 text-xs sm:text-right">
                    {formatTimeAgo(job.createdAt)}
                  </p>
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={labels.remove}
                  disabled={isRemoving && pendingJobId === job.id}
                  onClick={() => setJobToRemove(job)}
                >
                  {isRemoving && pendingJobId === job.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-4" aria-hidden />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ProjectJobPickerDialog
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        isAdding={isAdding}
        pendingJobId={pendingJobId}
        onSelectJob={handleSelectJob}
        labels={{
          pickerTitle: labels.pickerTitle,
          pickerDescription: labels.pickerDescription,
          pickerSearchPlaceholder: labels.pickerSearchPlaceholder,
          pickerEmpty: labels.pickerEmpty,
          pickerLoading: labels.pickerLoading,
          pickerError: labels.pickerError,
          untitled: labels.untitled,
        }}
      />

      <AlertDialog
        open={jobToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setJobToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.remove}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.confirmRemove}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              {labels.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={isRemoving}
              onClick={(event) => {
                event.preventDefault();
                handleRemoveJob();
              }}
            >
              {labels.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
