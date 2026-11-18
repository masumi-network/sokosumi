"use client";

import type { ProjectSeoPage } from "@sokosumi/core-client";
import { ChevronDown, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { SEO_BRIEF_ACTIONS } from "./seo-brief-model";
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
  const goal = useSeoSetupGoal(model, page.id, full);
  const label = (action: string) =>
    t(`brief.actions.${action.replaceAll(" ", "_")}`);
  const suggestion = model.setupGoalSuggestion;
  return (
    <div className="grid min-w-0 max-w-sm grid-cols-1 gap-3">
      {full ? (
        <p className="text-muted-foreground text-sm">
          {t("setup.goal.automatic")}
        </p>
      ) : null}
      <Collapsible
        open={model.setupGoalAdvanced}
        onOpenChange={model.setSetupGoalAdvanced}
      >
        <CollapsibleTrigger className="group flex min-h-8 items-center gap-1.5 text-sm font-medium">
          {t("setup.goal.advanced")}
          <ChevronDown
            aria-hidden
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid min-w-0 gap-3 pt-2">
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
                        full ? "setup.goal.autoOption" : "setup.goal.skip",
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
          ) : (
            <p role="status" className="text-muted-foreground text-sm">
              {t(
                model.brief.error || model.brief.data
                  ? "setup.goal.unavailable"
                  : "loading",
              )}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
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
    </div>
  );
}
