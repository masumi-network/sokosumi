"use client";

import { ChartColumn, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { SeoAgentStep } from "./seo-agent-model";
import { SeoStepRow } from "./seo-agent-steps";
import { useSeoConnectionStatus } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The Google statistics of the Agent tab as one slim line at its top. Open, it holds the Analytics step and its
 * button. The step exists only while no Analytics data is saved, so "connected" means connected and not synced
 * yet. It starts closed then, and open while Analytics is not connected.
 */
export function SeoAgentStatistics({
  step,
  model,
}: {
  step: Extract<SeoAgentStep, { kind: "connect" }>;
  model: SeoWorkspaceModel;
}) {
  const t = useTranslations("App.Seo");
  const status = useSeoConnectionStatus(step.provider).status.data?.status;
  const analytics =
    status === undefined
      ? "unknown"
      : status === "connected"
        ? "connected"
        : "missing";
  // The first known status sets the start; after that only a press moves the line. Analytics that connects
  // while the line is open keeps it open, with the focus on its button.
  const [picked, setPicked] = useState<boolean | null>(null);
  if (picked === null && analytics !== "unknown")
    setPicked(analytics === "missing");
  const open = picked ?? false;
  return (
    <Collapsible
      open={open}
      onOpenChange={setPicked}
      className="bg-background rounded-lg border"
      data-testid="seo-agent-statistics"
    >
      <CollapsibleTrigger className="focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-2">
        <ChartColumn
          aria-hidden
          className="text-muted-foreground size-4 shrink-0"
        />
        <span className="min-w-0 flex-1">
          {t("agent.statistics", { analytics })}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul role="list" className="border-t">
          <SeoStepRow step={step} model={model} first={false} flush />
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
