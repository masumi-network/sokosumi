"use client";

import { useJobsTwoPaneFit } from "@/app/agents/[agentId]/jobs/components/use-jobs-two-pane-fit";
import DefaultLoading from "@/components/default-loading";
import { useRouterRedirect } from "@/hooks/effects/use-router-redirect";

interface JobDetailRedirectProps {
  agentId: string;
  jobId: string;
}

/**
 * Auto-selects the first job into the right pane, but only once that pane is
 * actually on screen. The fit is measured from the panes row, so a collapsed
 * sidebar can turn the pane on at a window width an expanded one cannot.
 */
export default function JobDetailRedirect({
  agentId,
  jobId,
}: JobDetailRedirectProps) {
  const twoPaneFits = useJobsTwoPaneFit();

  useRouterRedirect(twoPaneFits ? `/agents/${agentId}/jobs/${jobId}` : null, {
    mode: "push",
    once: true,
  });

  return <DefaultLoading className="size-full flex-1 p-8" />;
}
