"use client";

import type { Agent } from "@sokosumi/database";
import { Sparkles } from "lucide-react";
import Image from "next/image";

import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { cn } from "@/lib/utils";

interface AgentIconProps {
  agent: Agent;
  className?: string;
  isMuted?: boolean;
}

export function AgentIcon({ agent, className, isMuted }: AgentIconProps) {
  const resolvedIcon = getAgentResolvedIcon(agent);

  if (resolvedIcon) {
    return (
      <Image
        src={resolvedIcon}
        alt={`${getAgentName(agent)} icon`}
        aria-hidden
        width={16}
        height={16}
        className={cn("size-4", className, isMuted && "opacity-60")}
      />
    );
  }

  return (
    <span className="[&>svg]:preserve-aspect-ratio-[xMidYMid_meet] inline-flex">
      <Sparkles
        strokeWidth={1}
        aria-hidden
        className={cn("size-4", className, isMuted && "text-muted-foreground")}
      />
    </span>
  );
}

export default AgentIcon;
