import type { AgentJobStatus } from "@sokosumi/database";
import { Clock } from "lucide-react";
import { useFormatter } from "next-intl";

import { AgentJobStatusBadge } from "@/components/jobs/agent-job-status-badge";

interface StatusDividerProps {
  jobId: string;
  status: AgentJobStatus;
  updatedAt: Date;
}

export default function StatusDivider({
  jobId,
  status,
  updatedAt,
}: StatusDividerProps) {
  const formatter = useFormatter();
  const label = formatter.dateTime(updatedAt, {
    dateStyle: "full",
    timeStyle: "short",
  });

  return (
    <div className="flex items-center justify-between gap-2">
      <Clock className="text-muted-foreground size-4" />
      <span className="text-muted-foreground text-xs uppercase">{label}</span>
      <hr className="border-muted h-0 flex-1 border-0 border-t" />
      <AgentJobStatusBadge
        key={`${jobId}-${status}-agent-status-badge`}
        status={status}
      />
    </div>
  );
}
