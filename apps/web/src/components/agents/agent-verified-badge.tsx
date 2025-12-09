"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AgentVerifiedBadgeProps {
  className?: string;
}

function AgentVerifiedBadge({ className }: AgentVerifiedBadgeProps) {
  const t = useTranslations("Components.Agents.AgentVerifiedBadge");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "bg-agent-verified-background flex items-center gap-1 rounded-md p-2",
            className,
          )}
        >
          <ShieldCheck
            strokeWidth={1}
            className="text-agent-verified-foreground size-6"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>
          {t("tooltip")}{" "}
          <Link
            href="https://docs.masumi.network/core-concepts/identity"
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
            onClick={(e) => e.stopPropagation()}
          >
            {t("learnMore")}
          </Link>{" "}
          {t("aboutAgentIdentities")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export { AgentVerifiedBadge };
