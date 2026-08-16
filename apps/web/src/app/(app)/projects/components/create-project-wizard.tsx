"use client";

import { track } from "@vercel/analytics";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ProjectBriefingField } from "@/app/projects/components/project-briefing-field";
import { PROJECT_NAME_MAX_LENGTH } from "@/app/projects/project-briefing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createProject } from "@/lib/actions/project/action";
import { cn } from "@/lib/utils";

import type { ProjectCreationSource } from "./project-form";

const TOTAL_STEPS = 3;

interface CreateProjectWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  creationSource?: ProjectCreationSource;
  onSuccess?: (projectId: string, name: string) => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
}

export function CreateProjectWizard({
  open,
  onOpenChange,
  initialName = "",
  creationSource,
  onSuccess,
  onSubmittingChange,
}: CreateProjectWizardProps) {
  const t = useTranslations("App.Projects");
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [briefing, setBriefing] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedName = name.trim();
  const canContinueFromName = trimmedName.length > 0;

  function updateSubmitting(nextIsSubmitting: boolean) {
    setIsSubmitting(nextIsSubmitting);
    onSubmittingChange?.(nextIsSubmitting);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isSubmitting) {
      return;
    }
    onOpenChange(nextOpen);
  }

  async function handleCreate() {
    if (!canContinueFromName || isSubmitting) {
      return;
    }

    updateSubmitting(true);
    try {
      const result = await createProject({
        name: trimmedName,
        briefing: briefing.trim() || null,
      });

      if (creationSource) {
        track("Project created", {
          source: creationSource,
          variant: "wizard",
        });
      }

      onSuccess?.(result.projectId, trimmedName);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to create project", error);
      toast.error(t("Detail.errors.create"));
    } finally {
      updateSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="create-project-wizard"
        className="bg-background top-0 left-0 grid h-dvh w-screen max-w-none! translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-[50%] sm:left-[50%] sm:h-[720px] sm:max-h-[92dvh] sm:w-[calc(100vw-4rem)] sm:max-w-2xl! sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border [&>button]:top-5 [&>button]:right-5 sm:[&>button]:top-6 sm:[&>button]:right-6"
      >
        <DialogTitle className="sr-only">{t("Wizard.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Wizard.briefing.subtitle")}
        </DialogDescription>

        <div className="relative flex items-center px-6 py-5 sm:px-8 sm:py-6">
          <div className="absolute inset-x-0 top-0 flex h-[3px] gap-1">
            {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
              <span
                key={index}
                className="bg-border h-full flex-1 overflow-hidden"
              >
                <span
                  className={cn(
                    "bg-primary block h-full w-full origin-left transition-transform duration-200 ease-out motion-reduce:transition-none",
                    index <= step ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
            ))}
          </div>
          <span className="text-muted-foreground/60 text-[0.6875rem] font-medium tracking-[0.16em] tabular-nums">
            {t("Wizard.stepLabel", {
              current: String(step + 1).padStart(2, "0"),
              total: String(TOTAL_STEPS).padStart(2, "0"),
            })}
          </span>
        </div>

        <div className="flex min-h-0 flex-col overflow-y-auto px-6 py-6 sm:px-16">
          <div
            key={step}
            className="animate-in fade-in-0 slide-in-from-bottom-1 my-auto w-full duration-200 ease-out motion-reduce:animate-none"
          >
            {step === 0 ? (
              <div className="mx-auto w-full max-w-md text-center">
                <h2 className="text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
                  {t("Wizard.name.title")}
                </h2>
                <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
                  {t("Wizard.name.subtitle")}
                </p>
                <Input
                  id="project-wizard-name"
                  autoFocus
                  maxLength={PROJECT_NAME_MAX_LENGTH}
                  placeholder={t("NewProject.namePlaceholder")}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={isSubmitting}
                  aria-label={t("NewProject.name")}
                  className="mt-10 h-14 text-[0.9375rem]"
                />
              </div>
            ) : null}

            {step === 1 ? (
              <div className="mx-auto flex min-h-0 w-full max-w-xl flex-col">
                <h2 className="text-center text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
                  {t("Wizard.briefing.title")}
                </h2>
                <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-center text-[0.9375rem] leading-[1.6] text-balance">
                  {t("Wizard.briefing.subtitle")}
                </p>
                <ProjectBriefingField
                  className="mt-8"
                  value={briefing}
                  onChange={setBriefing}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mx-auto w-full max-w-xl">
                <h2 className="text-center text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
                  {t("Wizard.review.title")}
                </h2>
                <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-center text-[0.9375rem] leading-[1.6] text-balance">
                  {t("Wizard.review.subtitle")}
                </p>

                <dl className="mt-8 space-y-5 text-left">
                  <div className="space-y-1.5">
                    <dt className="text-muted-foreground/70 text-xs font-medium tracking-wide uppercase">
                      {t("Wizard.review.nameLabel")}
                    </dt>
                    <dd className="text-sm font-medium">{trimmedName}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-muted-foreground/70 text-xs font-medium tracking-wide uppercase">
                      {t("Wizard.review.briefingLabel")}
                    </dt>
                    <dd>
                      {briefing.trim() ? (
                        <p className="text-foreground/80 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                          {briefing.trim()}
                        </p>
                      ) : (
                        <p className="text-muted-foreground/60 text-sm">
                          {t("Wizard.review.emptyBriefing")}
                        </p>
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="text-muted-foreground mt-8 space-y-2 text-sm leading-relaxed">
                  <p>{t("Wizard.review.briefingNote")}</p>
                  <p>{t("Wizard.review.memoryNote")}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="bg-background flex items-center justify-between gap-3 px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-6 sm:pb-6">
          {step > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground h-11 px-4"
              onClick={() => setStep((current) => current - 1)}
              disabled={isSubmitting}
            >
              <ArrowLeft className="size-4" />
              {t("Wizard.nav.back")}
            </Button>
          ) : (
            <div />
          )}

          {step < 2 ? (
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="h-11 px-6"
              disabled={step === 0 && !canContinueFromName}
              onClick={() => setStep((current) => current + 1)}
            >
              {t("Wizard.nav.next")}
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="h-11 px-6"
              disabled={!canContinueFromName || isSubmitting}
              onClick={() => void handleCreate()}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {isSubmitting ? t("Wizard.nav.creating") : t("Wizard.nav.create")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
