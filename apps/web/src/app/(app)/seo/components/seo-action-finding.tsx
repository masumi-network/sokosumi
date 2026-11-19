"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { ArrowUpRight, ClipboardPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { seoOverviewModel } from "./seo-overview-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** What the check found, where an issue is behind the action; else the effect of the fix. */
export function SeoActionFinding({
  action,
  model,
}: {
  action: ProjectSeoAction;
  model: SeoWorkspaceModel;
}) {
  return useSeoActionFinding(action, model);
}

export function useSeoActionFinding(
  action: ProjectSeoAction,
  model: SeoWorkspaceModel,
): string {
  const t = useTranslations("App.Seo");
  const problem = seoOverviewModel(model.data).actionProblem(action);
  if (action.decision) return action.why;
  return problem
    ? t("actions.problem", {
        check: t.markup("overview.failedCheck", {
          name: problem.check,
          // Plain words in a running line: the tag is for the title of an issue row.
          prefix: (chunks) => chunks,
        }),
        found: problem.found,
      })
    : action.expectedEffect;
}

/** The action's Task: a link once it exists, else the button that drafts it for an editor. */
export function SeoActionTaskButton({
  action,
  model,
}: {
  action: ProjectSeoAction;
  model: SeoWorkspaceModel;
}) {
  const t = useTranslations("App.Seo");
  return action.taskId ? (
    <Button asChild size="sm" variant="outline">
      <Link href={`/tasks/${encodeURIComponent(action.taskId)}`}>
        <ArrowUpRight />
        {t("openTask")}
      </Link>
    </Button>
  ) : model.data.availableActions.canEdit ? (
    <Button
      size="sm"
      // Tinted, not the brand fill: a draft is a quiet step the owner reviews later (owner, 2026-11-13).
      variant="secondary"
      loading={model.pending}
      onClick={() => {
        void model.createActionTask(action);
      }}
    >
      <ClipboardPlus />
      {t("actions.createTask")}
    </Button>
  ) : null;
}
