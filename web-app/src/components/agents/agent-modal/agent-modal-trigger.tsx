"use client";

import { useQueryState } from "nuqs";

import { cn } from "@/lib/utils";

interface AgentModalTriggerProps {
  agentId: string;
  children: React.ReactNode;
  className?: string | undefined;
}

function AgentModalTrigger({
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
