"use client";

import type { ProjectSeoPage } from "@sokosumi/core-client";
import { ChevronDown, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { SEO_BRIEF_ACTIONS, SEO_BRIEF_PAGE_LIMIT } from "./seo-brief-model";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { useSeoSetupGoal } from "./use-seo-setup-goal";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SKIP = "skip";
const ACTION_FIELD = "seo-setup-action";

export function SeoSetupGoal({
  model,
  page,
  full,
}: {
  model: SeoWorkspaceModel;
  page: ProjectSeoPage;
  full: boolean;
}) {
  const t = useTranslations("App.Seo");
  const advanced = useRef<HTMLButtonElement>(null);
  const goal = useSeoSetupGoal(model, page.id, full);
  const label = (action: string) =>
    t(`brief.actions.${action.replaceAll(" ", "_")}`);
  const suggestion = model.setupGoalSuggestion;
  const canRun = model.data.availableActions.canRequestAnalysis;
  return (
    <div className="grid min-w-0 max-w-sm grid-cols-1 gap-3">
      {full ? (
        <p className="text-muted-foreground text-sm">
          {goal.share && goal.action
            ? t("setup.goal.selected", { goal: label(goal.action) })
            : t("setup.goal.automatic")}
        </p>
      ) : null}
      <Collapsible
        open={model.setupGoalAdvanced}
        onOpenChange={model.setSetupGoalAdvanced}
      >
        <CollapsibleTrigger
          ref={advanced}
          className="group flex min-h-8 items-center gap-1.5 text-sm font-medium"
        >
          {t("setup.goal.advanced")}
          <ChevronDown
            aria-hidden
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid min-w-0 gap-3 pt-2">
          {!canRun ? (
            <p className="text-muted-foreground text-sm">
              {t("setup.goal.pausedHelp")}
            </p>
          ) : null}
          {goal.canEdit ? (
            <>
              {model.data.scope.pageIds.length > 1 ? (
                <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
                  <bdi>{page.url}</bdi>
                </p>
              ) : null}
              <SeoField id={ACTION_FIELD} label={t("setup.goal.question")}>
                <SeoSelect
                  id={ACTION_FIELD}
                  value={goal.action ?? SKIP}
                  disabled={goal.pending}
                  onValueChange={(value) =>
                    goal.choose(
                      SEO_BRIEF_ACTIONS.find((action) => action === value) ??
                        null,
                    )
                  }
                  options={[
                    {
                      value: SKIP,
                      label: t(
                        !canRun
                          ? "setup.goal.noSavedGoal"
                          : full
                            ? "setup.goal.autoOption"
                            : "setup.goal.skip",
                      ),
                    },
                    ...SEO_BRIEF_ACTIONS.map((value) => ({
                      value,
                      label: label(value),
                    })),
                  ]}
                />
              </SeoField>
              {!goal.action && suggestion ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto min-h-8 max-w-full justify-self-start whitespace-normal"
                  onClick={() => {
                    goal.choose(suggestion);
                    document.getElementById(ACTION_FIELD)?.focus();
                  }}
                >
                  {t("setup.goal.suggested", { action: label(suggestion) })}
                </Button>
              ) : null}
              {full && goal.action ? (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="seo-setup-share"
                    checked={goal.share}
                    disabled={goal.pending}
                    aria-describedby="seo-setup-share-details"
                    onCheckedChange={(value) => goal.setShare(value === true)}
                  />
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor="seo-setup-share">
                      {t("setup.goal.include")}
                    </Label>
                    <p
                      className="text-muted-foreground text-sm [overflow-wrap:anywhere]"
                      id="seo-setup-share-details"
                    >
                      {t("setup.goal.shareDetails", {
                        url: page.url,
                        goal: [
                          goal.role && t(`brief.roles.${goal.role}`),
                          label(goal.action),
                        ]
                          .filter(Boolean)
                          .join(" · "),
                      })}
                    </p>
                  </div>
                </div>
              ) : null}
              {!canRun ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!goal.changed && !goal.privateSaved}
                    aria-disabled={!goal.changed || undefined}
                    className="aria-disabled:opacity-50"
                    loading={goal.pending}
                    onClick={goal.changed ? () => void goal.save() : undefined}
                  >
                    {t("setup.goal.savePrivate")}
                  </Button>
                  <span role="status" className="text-muted-foreground text-sm">
                    {goal.privateSaved ? t("saved") : null}
                  </span>
                </div>
              ) : null}
              {goal.error ? (
                <div
                  role="alert"
                  className="text-destructive space-y-1 text-sm"
                >
                  <p>
                    {t(
                      goal.error === "conflict"
                        ? "brief.conflict"
                        : "saveFailed",
                    )}
                  </p>
                  {goal.error === "conflict" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void goal.reload()}
                    >
                      {t("brief.reload")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : model.brief.error ? (
            <div role="alert" className="space-y-1 text-sm">
              <p>{t("brief.readFailed")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  // Retry disappears on success. Keep keyboard focus in the disclosure.
                  advanced.current?.focus();
                  void goal.reload();
                }}
              >
                {t("brief.retry")}
              </Button>
            </div>
          ) : goal.atPageLimit ? (
            <div className="space-y-1 text-sm">
              <p>{t("brief.pageLimit", { count: SEO_BRIEF_PAGE_LIMIT })}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => model.setDialog("brief")}
              >
                {t("brief.edit")}
              </Button>
            </div>
          ) : (
            <p role="status" className="text-muted-foreground text-sm">
              {t(
                model.brief.data
                  ? canRun
                    ? "setup.goal.unavailable"
                    : "setup.goal.pausedUnavailable"
                  : "loading",
              )}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
      {canRun ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="h-auto min-h-8 max-w-full justify-self-start whitespace-normal"
          loading={goal.pending}
          disabled={goal.pending}
          onClick={() => void goal.review()}
        >
          <Play />
          {t(full ? "runFullAudit" : "runPageCheck")}
        </Button>
      ) : null}
    </div>
  );
}
