"use client";

import type { Agent } from "@sokosumi/database";
import { Sparkles } from "lucide-react";

import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import { cn } from "@/lib/utils";

import { ResolverSVGIcon } from "./resolver-svg-icon";

interface AgentIconProps {
  agent: Agent;
  className?: string;
  isMuted?: boolean;
}

export function AgentIcon({ agent, className, isMuted }: AgentIconProps) {
  const resolvedIcon = getAgentResolvedIcon(agent);
  let svgIcon: React.ReactNode | undefined = undefined;

  if (resolvedIcon) {
    svgIcon = (
      <ResolverSVGIcon
        svgUrl={resolvedIcon}
        alt={`${getAgentName(agent)} icon`}
        className={cn("size-4", className, isMuted && "opacity-60")}
      />
    );
  }

  if (svgIcon) {
    return svgIcon;
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
