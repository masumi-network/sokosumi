"use client";

import type { ProjectCompetitor } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { PencilIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { usePageListSearch } from "@/components/page-list-search";
import { Button } from "@/components/ui/button";
import {
  removeCompetitor,
  restoreCompetitor,
} from "@/lib/actions/competitors/action";
import { toActionRejectionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { signInAgain } from "@/lib/auth/sign-in-again";

import { CompetitorDialog } from "./competitor-dialog";
import {
  CompetitorsEmpty,
  CompetitorsItem,
  CompetitorsPanel,
} from "./competitors-panel";
import {
  dropStartFocus,
  endStartFocus,
  focusIsLost,
  handFocusToStart,
} from "./competitors-view";
import { FindCompetitors } from "./find-competitors";

function host(url: string): string {
  return URL.parse(url)?.hostname.replace(/^www\./, "") ?? url;
}

/**
 * The competitors the Project watches: add, change and remove them. A remove
 * shows at once and moves focus to the next Remove (the one before it for the
 * last row, Add when none is left, the start's Add by hand once the page
 * turns into the start). Once Core took it, a toast offers Undo, which asks
 * Core to undo exactly that removal: the competitor comes back as stored,
 * with what the checks found, unless it changed since.
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
  const router = useRouter();
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
  const addButton = useRef<HTMLButtonElement | null>(null);
  // A full list shows Add only once the removed row has left it.
  const focusAddWhenShown = useRef(false);
  // Stable, so it runs once: when the list leaves the page.
  const panelRef = useCallback(() => endStartFocus, []);

  function moveFocusFrom(competitor: ProjectCompetitor) {
    const at = visibleCompetitors.indexOf(competitor);
    const next = visibleCompetitors[at + 1] ?? visibleCompetitors[at - 1];
    if (next) return removeButtons.current.get(next.id)?.focus();
    if (addButton.current) addButton.current.focus();
    else focusAddWhenShown.current = true;
    // The last one gone, the page turns into the start.
    if (shown.length === 1) handFocusToStart(competitor.id);
  }

  /**
   * Undo for one removal. One request at a time; a failure that may pass
   * (the list is full, Core or the network failed) offers the same Undo
   * again, so the member is never asked to retry without a way to.
   */
  function undoRemoval(competitor: ProjectCompetitor, removal: number) {
    const { name } = competitor;
    let sending = false;
    const again = (label: string) => ({ label, onClick: () => void undo() });
    async function undo() {
      if (sending) return;
      sending = true;
      try {
        const result = await restoreCompetitor({
          projectId,
          competitorId: competitor.id,
          removal,
        });
        if (result.ok) return;
        const { kind } = result.error;
        if (kind === CORE_API_ERROR_KINDS.COMPETITOR_REMOVAL_STALE) {
          // Maybe an earlier try went through: show what is there now.
          router.refresh();
          toast.error(t("restoreStale", { name }));
        } else if (kind === CORE_API_ERROR_KINDS.COMPETITOR_NAME_TAKEN)
          toast.error(t("restoreNameTaken", { name }));
        else if (kind === CORE_API_ERROR_KINDS.COMPETITOR_LIMIT_REACHED)
          toast.error(t("restoreFull", { name, limit }), {
            action: again(t("undo")),
          });
        else
          toast.error(t("restoreFailed", { name }), {
            action: again(t("retry")),
          });
      } catch (error) {
        if (
          toActionRejectionError(error).code === CommonErrorCode.UNAUTHENTICATED
        )
          return signInAgain();
        toast.error(t("restoreFailed", { name }), {
          action: again(t("retry")),
        });
      } finally {
        sending = false;
      }
    }
    return undo;
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
        focusAddWhenShown.current = false;
        dropStartFocus(competitor.id);
        setError(result.error.message ?? t("failed"));
        return;
      }
      const undo = undoRemoval(competitor, result.value.removal);
      toast.success(t("removed", { name: competitor.name }), {
        action: { label: t("undo"), onClick: () => void undo() },
      });
    });
  }

  return (
    <CompetitorsPanel
      aside={t("count", { count: shown.length, limit })}
      className={className}
      id="competitors-list"
      ref={panelRef}
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
          <Button
            onClick={() => setEditing("new")}
            ref={(button) => {
              addButton.current = button;
              if (!button || !focusAddWhenShown.current) return;
              focusAddWhenShown.current = false;
              if (focusIsLost()) button.focus();
            }}
            size="sm"
          >
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
