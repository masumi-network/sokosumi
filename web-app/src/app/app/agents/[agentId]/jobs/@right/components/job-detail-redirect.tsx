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
    router.push(`/app/agents/${agentId}/jobs/${jobId}`);
  }, [agentId, jobId, router]);

  return (
    <DefaultLoading className="bg-muted/50 h-full w-full flex-1 rounded-xl border-none p-8" />
  );
}
