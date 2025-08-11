"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentWithRelations, getAgentName } from "@/lib/db";

import { useCreateJobModalContext } from "./create-job-modal-context";

interface CreateJobModalHeaderProps {
  agent: AgentWithRelations;
  isDemo: boolean;
}

export default function CreateJobModalHeader({
  agent,
  isDemo,
}: CreateJobModalHeaderProps) {
  const t = useTranslations("App.Agents.Jobs.CreateJob");
  const name = getAgentName(agent);

  const { isExpanded, handleCollapse, handleExpand, handleClose, loading } =
    useCreateJobModalContext();

  return (
    <div className="flex items-center justify-between py-3">
      <Button
        size="icon"
        variant="ghost"
        disabled={loading}
        className={loading ? "animate-pulse" : ""}
        onClick={isExpanded ? handleCollapse : handleExpand}
      >
        {isExpanded ? <ChevronUp /> : <ChevronDown />}
      </Button>
      <div className="flex items-center gap-2">
        <h3 className="truncate text-base font-medium md:text-lg">
          {t("title", { name })}
        </h3>
        {isDemo && (
          <Badge variant="default" className="bg-orange-100 text-orange-800">
            {t("demo")}
          </Badge>
        )}
      </div>
      <Button
        variant="ghost"
        onClick={handleClose}
        disabled={loading}
        className={loading ? "animate-pulse" : ""}
      >
        <span className="text-primary">{t("cancel")}</span>
      </Button>
    </div>
  );
}
