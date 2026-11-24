"use client";

import type { ProjectCompetitor } from "@sokosumi/core-client";
import { PencilIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { usePageListSearch } from "@/components/page-list-search";

import { Button } from "@/components/ui/button";
import {
  addCompetitor,
  removeCompetitor,
} from "@/lib/actions/competitors/action";

import { CompetitorDialog } from "./competitor-dialog";
import {
  CompetitorsEmpty,
  CompetitorsItem,
  CompetitorsPanel,
} from "./competitors-panel";
import { setStartAddFocus } from "./competitors-view";
import { FindCompetitors } from "./find-competitors";

function host(url: string): string {
  return URL.parse(url)?.hostname.replace(/^www\./, "") ?? url;
}

/**
 * The competitors the Project watches: add, change and remove them. A remove
 * shows at once and moves focus to the next Remove (the one before it for the
 * last row, Add when none is left). Once Core took it, a toast offers Undo,
 * which adds it again with the details it had: Core brings back the same
 * competitor, with what the checks found about it.
 */
export function CompetitorsWatchList({
  className,
  competitors,
  limit,
  projectId,
  projectName,
  readOnly,
}: {
  className?: string;
  competitors: ProjectCompetitor[];
  limit: number;
  projectId: string;
  projectName: string;
  readOnly: boolean;
}) {
  const t = useTranslations("App.Competitors.list");
  const [shown, hide] = useOptimistic(competitors, (list, id: string) =>
    list.filter((competitor) => competitor.id !== id),
  );
  const visibleCompetitors = usePageListSearch(shown, (competitor) => ({
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
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);

  function moveFocusFrom(competitor: ProjectCompetitor) {
    const at = visibleCompetitors.indexOf(competitor);
    const next = visibleCompetitors[at + 1] ?? visibleCompetitors[at - 1];
    if (next) return removeButtons.current.get(next.id)?.focus();
    addButton.current?.focus();
    // The last one gone, the page turns into the start.
    if (shown.length === 1) setStartAddFocus(true);
  }

  function restore(competitor: ProjectCompetitor) {
    const { name, websiteUrl, pricingUrl, instagramHandle, facebookHandle } =
      competitor;
    void addCompetitor({
      projectId,
      name,
      websiteUrl,
      pricingUrl,
      instagramHandle,
      facebookHandle,
    }).then((result) => {
      if (!result.ok)
        toast.error(result.error.message ?? t("restoreFailed", { name }));
    });
  }

  function remove(competitor: ProjectCompetitor) {
    setError(null);
    moveFocusFrom(competitor);
    startTransition(async () => {
      hide(competitor.id);
      const result = await removeCompetitor({
        projectId,
        competitorId: competitor.id,
      });
      if (!result.ok) {
        setStartAddFocus(false);
        setError(result.error.message ?? t("failed"));
        return;
      }
      toast.success(t("removed", { name: competitor.name }), {
        action: { label: t("undo"), onClick: () => restore(competitor) },
      });
    });
  }

  return (
    <CompetitorsPanel
      aside={t("count", { count: shown.length, limit })}
      className={className}
      id="competitors-list"
      title={t("title")}
    >
      {shown.length === 0 ? (
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
                    onClick={() => setEditing(competitor)}
                    size="sm"
                    variant="ghost"
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  <Button
                    aria-label={t("removeNamed", { name: competitor.name })}
                    className="size-8 px-0"
                    onClick={() => remove(competitor)}
                    ref={(button) => {
                      if (button)
                        removeButtons.current.set(competitor.id, button);
                      else removeButtons.current.delete(competitor.id);
                    }}
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
      {readOnly ? null : shown.length >= limit ? (
        <p className="text-muted-foreground px-2 pb-1 text-xs">
          {t("full", { limit })}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 px-1 pb-1">
          <FindCompetitors
            projectId={projectId}
            projectName={projectName}
            room={limit - shown.length}
          />
          <Button onClick={() => setEditing("new")} ref={addButton} size="sm">
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
