"use client";

import { CircleCheck, CircleX, Clock3, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelProjectCloseOwedWork,
  retryProjectClose,
} from "@/lib/actions/project/action";
import type { ProjectCloseStatus } from "@/lib/clients/generated/core";

interface ProjectCloseStatusProps {
  status: ProjectCloseStatus;
}

type RecoveryAction = "retry" | "cancelOwed";

interface RecoveryAttempt {
  operationId: string;
  reason: string;
}

function statusIcon(state: ProjectCloseStatus["state"]) {
  if (state === "CLOSED") {
    return <CircleCheck className="size-5" aria-hidden />;
  }
  if (state === "CLOSE_FAILED") {
    return <CircleX className="size-5" aria-hidden />;
  }
  return <Clock3 className="size-5" aria-hidden />;
}

export function ProjectCloseStatusCard({ status }: ProjectCloseStatusProps) {
  const t = useTranslations("App.Projects.Detail.close");
  const format = useFormatter();
  const router = useRouter();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const recoveryTriggerRef = useRef<HTMLButtonElement>(null);
  const recoveryAttemptsRef = useRef<
    Record<RecoveryAction, RecoveryAttempt | null>
  >({
    retry: null,
    cancelOwed: null,
  });
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (status.state !== "CLOSING" || isPending) return;

    const interval = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [status.state, isPending, router]);

  const [previousStatusState, setPreviousStatusState] = useState(status.state);
  if (previousStatusState !== status.state) {
    setPreviousStatusState(status.state);
    if (status.state !== "CLOSE_FAILED") {
      recoveryAttemptsRef.current = { retry: null, cancelOwed: null };
      setReason("");
      setReasonError(false);
      setRecoveryAction(null);
    }
  }

  const formattedCutoff = format.dateTime(status.cutoffAt, "dateTimeMedium");
  const formattedCompletedAt = format.dateTime(
    status.completedAt ?? status.cutoffAt,
    "dateTimeMedium",
  );

  const title = t(`status.${status.state}.title`);
  let description: string;
  if (status.state === "CLOSED") {
    description = t("status.CLOSED.description", {
      completedAt: formattedCompletedAt,
    });
  } else if (status.state === "CLOSE_FAILED") {
    description = t(
      status.failure?.seriesTaskId
        ? "status.CLOSE_FAILED.descriptionWithCancel"
        : "status.CLOSE_FAILED.descriptionRetryOnly",
      { cutoff: formattedCutoff },
    );
  } else {
    description = t("status.CLOSING.description", {
      cutoff: formattedCutoff,
      count: status.owedOccurrenceCount,
    });
  }

  function openRecovery(action: RecoveryAction) {
    setReason("");
    setReasonError(false);
    setRecoveryAction(action);
  }

  function handleRecovery() {
    if (!recoveryAction) {
      return;
    }

    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setReasonError(true);
      reasonRef.current?.focus();
      return;
    }

    const activeRecoveryAction = recoveryAction;
    const previousRecoveryAttempt =
      recoveryAttemptsRef.current[activeRecoveryAction];
    const recoveryAttempt =
      previousRecoveryAttempt?.reason === normalizedReason
        ? previousRecoveryAttempt
        : {
            operationId: crypto.randomUUID(),
            reason: normalizedReason,
          };
    recoveryAttemptsRef.current[activeRecoveryAction] = recoveryAttempt;

    startTransition(async () => {
      try {
        const input = {
          projectId: status.projectId,
          operationId: recoveryAttempt.operationId,
          expectedProjectRevision: status.projectRevision,
          reason: normalizedReason,
        };
        if (activeRecoveryAction === "retry") {
          await retryProjectClose(input);
        } else {
          await cancelProjectCloseOwedWork(input);
        }
        recoveryAttemptsRef.current[activeRecoveryAction] = null;
        setRecoveryAction(null);
        toast.success(t("recovery.success"));
        router.refresh();
      } catch {
        router.refresh();
        toast.error(t("recovery.error"), { duration: Infinity });
      }
    });
  }

  return (
    <>
      <Card
        role={status.state === "CLOSE_FAILED" ? "alert" : "status"}
        className={
          status.state === "CLOSE_FAILED"
            ? "border-semantic-destructive-tertiary"
            : undefined
        }
      >
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <span
              className={
                status.state === "CLOSE_FAILED"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {statusIcon(status.state)}
            </span>
            <div className="min-w-0 space-y-1">
              <h2 className="font-semibold text-balance">{title}</h2>
              <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
                {description}
              </p>
              {status.failure ? (
                <p className="text-destructive text-sm leading-relaxed text-pretty">
                  {status.failure.message}
                </p>
              ) : null}
            </div>
          </div>

          {status.state === "CLOSE_FAILED" ? (
            <div className="flex flex-wrap gap-3 ps-8">
              <Button
                type="button"
                variant="outline"
                onClick={(event) => {
                  recoveryTriggerRef.current = event.currentTarget;
                  openRecovery("retry");
                }}
              >
                {t("recovery.retryAction")}
              </Button>
              {status.failure?.seriesTaskId ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={(event) => {
                    recoveryTriggerRef.current = event.currentTarget;
                    openRecovery("cancelOwed");
                  }}
                >
                  {t("recovery.cancelOwedAction")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={recoveryAction !== null && status.state === "CLOSE_FAILED"}
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setRecoveryAction(null);
          }
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            recoveryTriggerRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {recoveryAction
                ? t(`recovery.${recoveryAction}.title`)
                : t("recovery.retry.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {recoveryAction
                ? t(`recovery.${recoveryAction}.description`)
                : t("recovery.retry.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`project-close-recovery-reason-${status.id}`}>
              {t("recovery.reasonLabel")}
            </Label>
            <Textarea
              ref={reasonRef}
              id={`project-close-recovery-reason-${status.id}`}
              name="projectCloseRecoveryReason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(false);
              }}
              placeholder={t("recovery.reasonPlaceholder")}
              aria-invalid={reasonError}
              aria-describedby={
                reasonError
                  ? `project-close-recovery-reason-error-${status.id}`
                  : undefined
              }
              disabled={isPending}
            />
            {reasonError ? (
              <p
                id={`project-close-recovery-reason-error-${status.id}`}
                className="text-destructive text-sm"
              >
                {t("recovery.reasonRequired")}
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {t("recovery.keepFailed")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                recoveryAction === "cancelOwed"
                  ? "bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover"
                  : undefined
              }
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                handleRecovery();
              }}
            >
              {isPending ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              {recoveryAction === "cancelOwed"
                ? t("recovery.cancelOwedAction")
                : t("recovery.retryAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
