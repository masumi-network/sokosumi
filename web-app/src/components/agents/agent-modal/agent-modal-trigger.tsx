"use client";

import { useQueryState } from "nuqs";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface AgentModalTriggerProps {
  agentId: string;
  children: React.ReactNode;
  className?: string | undefined;
  skeleton?: React.ReactNode | undefined;
}

function AgentModalTrigger(props: AgentModalTriggerProps) {
  return (
    <Suspense fallback={<AgentModalTriggerSkeleton />}>
      <AgentModalTriggerClient {...props} />
    </Suspense>
  );
}

function AgentModalTriggerClient({
  agentId,
  children,
  className,
}: AgentModalTriggerProps) {
  const [_, setAgentId] = useQueryState("agentId");

  return (
    <div
      className={cn("cursor-pointer", className)}
      onClick={() => {
        setAgentId(agentId);
      }}
    >
      {children}
    </div>
  );
}

function AgentModalTriggerSkeleton() {
  return <Skeleton className="h-10 w-30" />;
}

export { AgentModalTrigger };
