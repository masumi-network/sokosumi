"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import type { StudioLabels } from "./types";
import type { FailedGeneration } from "./use-generation-queue";

export function StudioFailedSubmission({
  failure,
  hasNewerDraft = false,
  labels,
  onDismiss,
  onEdit,
  onRetry,
}: {
  failure: FailedGeneration;
  hasNewerDraft?: boolean;
  labels: StudioLabels;
  onDismiss: () => void;
  onEdit?: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("App.Studio");
  const { request, code, message } = failure;
  const uncertain = code === "unreachable";
  return (
    <article
      aria-label={t("savedSubmission", { model: request.modelLabel })}
      className="bg-card-background flex items-start gap-3 rounded-xl border p-3 text-sm"
    >
      <AlertTriangle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium" role="status">
          {uncertain ? t("submissionUnconfirmed") : t("submissionNotStarted")}
        </p>
        <p className="text-muted-foreground break-words">
          {uncertain
            ? labels.errorUnreachable
            : code === "insufficient_credits"
              ? labels.errorInsufficientCredits
              : message}
        </p>
        <p className="text-muted-foreground break-words text-xs">
          {request.modelLabel} · {request.settings.aspectRatio} ·{" "}
          {request.settings.resolution}
        </p>
        <details>
          <summary className="focus-visible:ring-ring-halo w-fit cursor-pointer rounded outline-none focus-visible:ring-[3px]">
            {t("viewSavedBrief")}
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words">
            {request.prompt}
          </p>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-10 md:h-8"
            onClick={onRetry}
            size="sm"
            variant="secondary"
          >
            {t("retrySubmission")}
          </Button>
          {!uncertain && onEdit ? (
            <Button
              className="h-10 md:h-8"
              disabled={hasNewerDraft}
              onClick={onEdit}
              size="sm"
              variant="ghost"
            >
              {t("editSavedBrief")}
            </Button>
          ) : null}
          <Button
            className="h-10 md:h-8"
            onClick={onDismiss}
            size="sm"
            variant="ghost"
          >
            {t("dismissSubmission")}
          </Button>
        </div>
        {!uncertain && onEdit && hasNewerDraft ? (
          <p className="text-muted-foreground text-xs">
            {t("recoveryEditBlocked")}
          </p>
        ) : null}
      </div>
    </article>
  );
}
