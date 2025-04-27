"use client";

import { useQueryState } from "nuqs";
import { Suspense } from "react";

import { cn } from "@/lib/utils";

interface AgentModalTriggerProps {
  agentId: string;
  children: React.ReactNode;
  className?: string | undefined;
}

function AgentModalTrigger(props: AgentModalTriggerProps) {
  return (
    <Suspense>
      <AgentModalTriggerClient {...props} />
    </Suspense>
  );
}

function AgentModalTriggerClient({
  agentId,
  children,
  className,
}: AgentModalTriggerProps) {
  const [_, setModalAgentId] = useQueryState("modalAgentId");

  return (
    <div
      className={cn("cursor-pointer", className)}
      onClick={() => {
        setModalAgentId(agentId);
      }}
    >
      {children}
    </div>
  );
}

export { AgentModalTrigger };
