"use client";

import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { seoMonitorBlock } from "./seo-monitor-model";
import { SeoMonitorRow } from "./seo-monitor-row";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * Scheduled checks on the agent's home. Each monitor shows its plan, its last result and what changed, with its
 * commands in place. With no monitor there is no card: the arrow of the run schedules the first one.
 */
export function SeoAutomation({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo.monitor");
  const { monitors } = model.data;
  const block = seoMonitorBlock(model.data);
  if (!monitors.length) return null;
  return (
    <div
      className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}
      data-testid="seo-automation"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <h3 className="min-w-0 text-sm font-semibold">{t("title")}</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={block !== null || model.pending}
          onClick={() => model.setDialog("monitor")}
        >
          <CalendarClock />
          {t("createAnother")}
        </Button>
      </div>
      {block ? (
        <p className="text-muted-foreground text-xs" role="note">
          {t(`blocked.${block}`)}
        </p>
      ) : null}
      <ul className="divide-border divide-y">
        {monitors.map((monitor) => (
          <SeoMonitorRow key={monitor.id} model={model} monitor={monitor} />
        ))}
      </ul>
    </div>
  );
}
