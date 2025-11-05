"use client";

import type { Agent } from "@sokosumi/database";
import { Sparkles } from "lucide-react";
import { memo, useMemo } from "react";

import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { cn } from "@/lib/utils";

import { ResolverSVGIcon } from "./resolver-svg-icon";

interface AgentIconProps {
  agent: Agent;
  className?: string;
  isMuted?: boolean;
}

function AgentIconComponent({ agent, className, isMuted }: AgentIconProps) {
  const resolvedIcon = useMemo(() => getAgentResolvedIcon(agent), [agent]);

  const agentName = useMemo(() => getAgentName(agent), [agent]);

  if (resolvedIcon) {
    return (
      <ResolverSVGIcon
        svgUrl={resolvedIcon}
        alt={`${agentName} icon`}
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

export const AgentIcon = memo(AgentIconComponent);

export default AgentIcon;
