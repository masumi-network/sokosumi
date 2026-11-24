"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { CompetitorDialog } from "./competitor-dialog";
import { CompetitorsExample } from "./competitors-finding";
import { takeStartAddFocus } from "./competitors-view";
import { FindCompetitors } from "./find-competitors";

/**
 * The page before the Project watches anybody: what the check gives, an
 * example of a week's findings, and one main action, finding competitors.
 */
export function CompetitorsStart({
  creditsPerCompetitor,
  limit,
  projectId,
  projectName,
}: {
  creditsPerCompetitor: number;
  limit: number;
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations("App.Competitors");
  const [adding, setAdding] = useState(false);

  return (
    <section
      aria-labelledby="competitors-start"
      className={cn(
        HOLDER_CLASS,
        "grid items-center gap-6 p-4 md:p-8 lg:grid-cols-2 lg:gap-12",
      )}
    >
      <div className="flex max-w-prose flex-col gap-4">
        <h2
          className="text-2xl font-light tracking-tight md:text-3xl"
          id="competitors-start"
        >
          {t("start.title")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("start.body")}</p>
        <div className="flex flex-wrap gap-2">
          <FindCompetitors
            projectId={projectId}
            projectName={projectName}
            room={limit}
            variant="primary"
          />
          <Button
            onClick={() => setAdding(true)}
            ref={(button) => {
              if (button && takeStartAddFocus()) button.focus();
            }}
            size="sm"
          >
            {t("start.add")}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t("start.price", { credits: creditsPerCompetitor })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground px-2 text-xs font-medium">
          {t("example.label")}
        </p>
        <CompetitorsExample />
      </div>
      {adding ? (
        <CompetitorDialog
          competitor={null}
          onClose={() => setAdding(false)}
          projectId={projectId}
        />
      ) : null}
    </section>
  );
}
