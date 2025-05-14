"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { AgentWithRelations, getAgentName } from "@/lib/db";

interface CreateJobModalHeaderProps {
  agent: AgentWithRelations;
  loading: boolean;
  onClose: () => void;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}

export default function CreateJobModalHeader({
  agent,
  loading,
  onClose,
  expanded,
  onExpand,
  onCollapse,
}: CreateJobModalHeaderProps) {
  const t = useTranslations("App.Agents.Jobs.CreateJob");
  const name = getAgentName(agent);

  return (
    <div className="flex items-center justify-between py-3">
      <Button
        size="icon"
        variant="ghost"
        onClick={expanded ? onCollapse : onExpand}
      >
        {expanded ? <ChevronUp /> : <ChevronDown />}
      </Button>
      <h3 className="text-lg font-medium">{t("title", { name })}</h3>
      <Button
        variant="ghost"
        onClick={onClose}
        disabled={loading}
        className={loading ? "animate-pulse" : ""}
      >
        <span className="text-primary">{t("cancel")}</span>
      </Button>
    </div>
  );
}
