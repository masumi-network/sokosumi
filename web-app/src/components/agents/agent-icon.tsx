"use client";

import { Sparkles } from "lucide-react";

import { getAgentResolvedIcon } from "@/lib/db/helpers";
import { cn } from "@/lib/utils";
import type { Agent } from "@/prisma/generated/client";

interface AgentIconProps {
  agent: Agent;
  className?: string;
  isMuted?: boolean;
}

export function AgentIcon({ agent, className, isMuted }: AgentIconProps) {
  const resolvedIcon = getAgentResolvedIcon(agent);

  if (resolvedIcon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolvedIcon}
        alt=""
        aria-hidden
        className={cn("size-4", className, isMuted && "opacity-60")}
      />
    );
  }

  return (
    <Sparkles
      aria-hidden
      className={cn("size-4", className, isMuted && "text-muted-foreground")}
    />
  );
}

export default AgentIcon;
