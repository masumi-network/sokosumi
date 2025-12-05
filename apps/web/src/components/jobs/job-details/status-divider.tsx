import { type JobWithEvent } from "@sokosumi/database";
import { Clock } from "lucide-react";
import { useFormatter } from "next-intl";

import { JobStatusBadge } from "@/components/jobs/job-status-badge";

interface StatusDividerProps {
  data: JobWithEvent;
}

export default function StatusDivider({ data }: StatusDividerProps) {
  const { jobType } = data.job;
  const { status } = data.event;
  const formatter = useFormatter();
  const label = formatter.dateTime(data.event.updatedAt, {
    dateStyle: "full",
    timeStyle: "short",
  });

  return (
    <div className="flex items-center justify-between gap-2">
      <Clock className="text-muted-foreground size-4" />
      <span className="text-muted-foreground text-xs uppercase">{label}</span>
      <hr className="border-muted h-0 flex-1 border-0 border-t" />
      <JobStatusBadge
        key={`${data.job.id}-${data.event.status}-details-badge`}
        status={status}
        jobType={jobType}
      />
    </div>
  );
}
