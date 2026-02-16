"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import DefaultLoading from "@/components/default-loading";

interface JobDetailRedirectProps {
  agentId: string;
  jobId: string;
}

export default function JobDetailRedirect({
  agentId,
  jobId,
}: JobDetailRedirectProps) {
  const router = useRouter();

  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      return;
    }
    router.push(`/agents/${agentId}/jobs/${jobId}`);
  }, [agentId, jobId, router]);

  return <DefaultLoading className="h-full w-full flex-1 p-8" />;
}
