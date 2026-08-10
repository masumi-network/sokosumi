"use client";

import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  CREATE_ORGANIZATION_DETAILS_FORM_ID,
  CreateOrganizationStep,
} from "./create-organization-steps";
import {
  CREATE_ORGANIZATION_SUCCESS_STEP,
  CREATE_ORGANIZATION_TOTAL_STEPS,
  CREATE_ORGANIZATION_TRANSLATION_NAMESPACE,
  useCreateOrganizationFlow,
} from "./use-create-organization-flow";

interface CreateOrganizationWizardProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export function CreateOrganizationWizard({
  open,
  onOpenChange,
}: CreateOrganizationWizardProps) {
  const t = useTranslations(CREATE_ORGANIZATION_TRANSLATION_NAMESPACE);
  const flow = useCreateOrganizationFlow();
  const { activateWorkspace, isBusy, organizationId, resetAll, setStep, step } =
    flow;

  // Reset to a clean slate whenever the wizard is (re)opened.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      resetAll();
    }
    wasOpenRef.current = open;
  }, [open, resetAll]);

  const handleRequestClose = (nextOpen: boolean) => {
    if (isBusy) return;
    onOpenChange(nextOpen);
  };

  const handleFinish = () => {
    if (organizationId) {
      activateWorkspace();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleRequestClose}>
      <DialogContent className="bg-background top-0 left-0 grid h-dvh w-screen max-w-none! translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-[50%] sm:left-[50%] sm:h-[640px] sm:max-h-[92dvh] sm:w-[calc(100vw-4rem)] sm:max-w-2xl! sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border [&>button]:top-5 [&>button]:right-5 sm:[&>button]:top-6 sm:[&>button]:right-6">
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("description")}
        </DialogDescription>

        {/* Progress rail + slide counter */}
        <div className="relative flex items-center px-6 py-5 sm:px-8 sm:py-6">
          <div className="absolute inset-x-0 top-0 flex h-[3px] gap-1">
            {Array.from({ length: CREATE_ORGANIZATION_TOTAL_STEPS }).map(
              (_, index) => (
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
              ),
            )}
          </div>
          <span className="text-muted-foreground/60 text-[0.6875rem] font-medium tracking-[0.16em] tabular-nums">
            {String(step + 1).padStart(2, "0")} /{" "}
            {String(CREATE_ORGANIZATION_TOTAL_STEPS).padStart(2, "0")}
          </span>
          <span className="sr-only" aria-live="polite">
            {step + 1} / {CREATE_ORGANIZATION_TOTAL_STEPS}
          </span>
        </div>

        {/* Stage — one focal object per step, fixed height so nothing jumps */}
        {/* `m-auto` on the child, not `justify-center` on the scroller: a
            centered flex child that outgrows its container gets clipped at the
            top with no way to scroll back up. */}
        <div className="flex min-h-0 flex-col items-center overflow-y-auto px-6 py-6 text-center sm:px-16">
          <div
            key={step}
            className="animate-in fade-in-0 slide-in-from-bottom-1 my-auto w-full duration-200 ease-out motion-reduce:animate-none"
          >
            <CreateOrganizationStep flow={flow} />
          </div>
        </div>

        {/* Footer — exactly one filled action on screen */}
        <div className="bg-background flex items-center justify-between gap-3 px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-6 sm:pb-6">
          {/* Back stops at the last setup step. Past it there is nothing left
              to configure, and the organization already exists — offering
              "Back" there would imply the creation can be undone. */}
          {step > 0 && step < CREATE_ORGANIZATION_SUCCESS_STEP ? (
            <Button
              variant="ghost"
              className="text-muted-foreground h-11 px-4"
              onClick={() => setStep((current) => current - 1)}
              disabled={isBusy}
            >
              <ArrowLeft className="size-4" />
              {t("Nav.back")}
            </Button>
          ) : step < CREATE_ORGANIZATION_SUCCESS_STEP ? (
            <div />
          ) : null}

          {step === 0 && (
            <Button
              type="submit"
              form={CREATE_ORGANIZATION_DETAILS_FORM_ID}
              variant="primary"
              size="lg"
              className="h-11 px-6"
              disabled={isBusy}
            >
              {flow.isCreatingOrg && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {flow.isCreatingOrg ? t("Nav.creating") : t("Nav.next")}
              {!flow.isCreatingOrg && <ArrowRight className="size-4" />}
            </Button>
          )}
          {step === 1 && (
            <Button
              variant="primary"
              size="lg"
              className="h-11 px-6"
              onClick={() => setStep((current) => current + 1)}
              disabled={isBusy}
            >
              {t("Nav.next")}
              <ArrowRight className="size-4" />
            </Button>
          )}
          {/* Last configurable step: the label says so, and drops the forward
              arrow so it doesn't read as just another "next". */}
          {step === 2 && (
            <Button
              variant="primary"
              size="lg"
              className="h-11 px-6"
              onClick={() => setStep((current) => current + 1)}
              disabled={isBusy}
            >
              {t("Nav.finishSetup")}
            </Button>
          )}
          {step === CREATE_ORGANIZATION_SUCCESS_STEP && (
            <Button
              variant="primary"
              size="lg"
              className="h-11 w-full px-6"
              onClick={handleFinish}
            >
              {t("Nav.finish")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
