"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import ClickBlocker from "@/components/click-blocker";

interface AgentSummaryProps {
  summary: string;
}

export default function AgentSummary({ summary }: AgentSummaryProps) {
  const t = useTranslations("Components.Agents.AgentCard");

  const [isExpanded, setIsExpanded] = useState(false);
  const canBeExpanded = summary.length > 150;

  const handleToggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="text-muted-foreground text-sm">
      {isExpanded ? summary : summary.slice(0, 150)}
      {canBeExpanded && (
        <ClickBlocker className="inline-block space-x-0.5">
          <span>{!isExpanded && "..."}</span>
          <b className="text-primary" onClick={handleToggleExpanded}>
            {isExpanded ? t("showLess") : t("showMore")}
          </b>
        </ClickBlocker>
      )}
    </div>
  );
}
