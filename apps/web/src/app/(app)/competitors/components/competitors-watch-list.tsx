"use client";

import type { ProjectCompetitor } from "@sokosumi/core-client";
import { PencilIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { usePageListSearch } from "@/components/page-list-search";

import { Button } from "@/components/ui/button";
import { removeCompetitor } from "@/lib/actions/competitors/action";

import { CompetitorDialog } from "./competitor-dialog";
import {
  CompetitorsEmpty,
  CompetitorsItem,
  CompetitorsPanel,
} from "./competitors-panel";
import { FindCompetitors } from "./find-competitors";

function host(url: string): string {
  return URL.parse(url)?.hostname.replace(/^www\./, "") ?? url;
}

/** The competitors the Project watches: add, change and remove them. */
export function CompetitorsWatchList({
  competitors,
  limit,
  projectId,
  projectName,
  readOnly,
}: {
  competitors: ProjectCompetitor[];
  limit: number;
  projectId: string;
  projectName: string;
  readOnly: boolean;
}) {
  const t = useTranslations("App.Competitors.list");
  const visibleCompetitors = usePageListSearch(competitors, (competitor) => ({
    primary: [competitor.name, competitor.id],
    secondary: [
      competitor.websiteUrl,
      competitor.pricingUrl,
      competitor.instagramHandle,
      competitor.facebookHandle,
    ],
  }));
  const [editing, setEditing] = useState<ProjectCompetitor | "new" | null>(
    null,
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(competitor: ProjectCompetitor) {
    setRemoving(competitor.id);
    setError(null);
    startTransition(async () => {
      const result = await removeCompetitor({
        projectId,
        competitorId: competitor.id,
      });
      if (!result.ok) setError(result.error.message ?? t("failed"));
      setRemoving(null);
    });
  }

  return (
    <CompetitorsPanel
      aside={t("count", { count: competitors.length, limit })}
      id="competitors-list"
      title={t("title")}
    >
      {competitors.length === 0 ? (
        <CompetitorsEmpty>{t("emptyReadOnly")}</CompetitorsEmpty>
      ) : (
        visibleCompetitors.map((competitor) => {
          const facts = [
            competitor.websiteUrl
              ? host(competitor.websiteUrl)
              : t("noWebsite"),
            competitor.pricingUrl ? t("pricingPage") : null,
            competitor.instagramHandle
              ? `@${competitor.instagramHandle}`
              : null,
            competitor.facebookHandle
              ? t("facebook", { handle: competitor.facebookHandle })
              : null,
          ].filter(Boolean);
          return (
            <CompetitorsItem
              className="flex items-center justify-between gap-3"
              key={competitor.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {competitor.name}
                </p>
                <p className="text-muted-foreground text-xs break-words">
                  {facts.join(" · ")}
                </p>
              </div>
              {readOnly ? null : (
                <div className="flex shrink-0">
                  <Button
                    aria-label={t("editNamed", { name: competitor.name })}
                    className="size-8 px-0"
                    disabled={removing !== null}
                    onClick={() => setEditing(competitor)}
                    size="sm"
                    variant="ghost"
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  <Button
                    aria-label={t("removeNamed", { name: competitor.name })}
                    className="size-8 px-0"
                    disabled={removing !== null}
                    loading={removing === competitor.id}
                    onClick={() => remove(competitor)}
                    size="sm"
                    variant="ghost"
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              )}
            </CompetitorsItem>
          );
        })
      )}
      {error ? (
        <p className="px-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {readOnly ? null : competitors.length >= limit ? (
        <p className="text-muted-foreground px-2 pb-1 text-xs">
          {t("full", { limit })}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 px-1 pb-1">
          <FindCompetitors
            projectId={projectId}
            projectName={projectName}
            room={limit - competitors.length}
          />
          <Button onClick={() => setEditing("new")} size="sm">
            {t("add")}
          </Button>
        </div>
      )}
      {editing ? (
        <CompetitorDialog
          competitor={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          projectId={projectId}
        />
      ) : null}
    </CompetitorsPanel>
  );
}
