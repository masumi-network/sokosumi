"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useJobsTwoPaneFit } from "@/app/agents/[agentId]/jobs/components/use-jobs-two-pane-fit";
import DefaultLoading from "@/components/default-loading";

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
  const router = useRouter();
  const twoPaneFits = useJobsTwoPaneFit();
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (!twoPaneFits || hasRedirectedRef.current) {
      return;
    }

    hasRedirectedRef.current = true;
    router.push(`/agents/${agentId}/jobs/${jobId}`);
  }, [agentId, jobId, router, twoPaneFits]);

  return <DefaultLoading className="h-full w-full flex-1 p-8" />;
}
