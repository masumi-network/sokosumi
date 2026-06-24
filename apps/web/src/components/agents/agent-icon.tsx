"use client";

import { Bot } from "lucide-react";
import { memo } from "react";

import { cn } from "@/lib/utils";

import { ResolverSVGIcon } from "./resolver-svg-icon";

interface AgentIcon {
  name: string;
  icon: string | null;
}
interface AgentIconProps {
  agent: AgentIcon;
  className?: string;
  isMuted?: boolean;
}

function AgentIconComponent({ agent, className, isMuted }: AgentIconProps) {
  const { icon, name } = agent;

  if (icon) {
    return (
      <ResolverSVGIcon
        svgUrl={icon}
        alt={`${name} icon`}
        className={cn("size-4", className, isMuted && "opacity-60")}
      />
    );
  }

  return (
    <span className="[&>svg]:preserve-aspect-ratio-[xMidYMid_meet] inline-flex">
      <Bot
        strokeWidth={1.5}
        aria-hidden
        className={cn("size-4", className, isMuted && "text-muted-foreground")}
      />
    </span>
  );
}

export const AgentIcon = memo(AgentIconComponent);

export default AgentIcon;
