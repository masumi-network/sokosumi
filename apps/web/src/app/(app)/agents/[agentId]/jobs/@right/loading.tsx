import { JobDetailSkeleton } from "@/app/agents/[agentId]/jobs/components/jobs-loading";

/** Sync shell only — no cookies/`connection()`/server i18n (Instant Nav). */
export default function AgentJobsRightLoading() {
  return <JobDetailSkeleton />;
}
