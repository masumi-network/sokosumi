"use client";

import type { AdminPreprodAccess } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { ReasonField } from "@/components/admin/reason-field";
import { LoadErrorState } from "@/components/common/load-error-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { setAdminPreprodAccessAction } from "@/lib/actions/admin-preprod-access/action";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { refreshPage } from "@/lib/actions/refresh-page-action";
import type { PreprodAccessTarget } from "@/lib/services/admin-preprod-access.service";

interface PreprodAccessSectionProps {
  target: PreprodAccessTarget;
  /** The user's or Organization's name, as the dialog names it. */
  targetName: string;
  /** The page's read from Core; null when Core did not answer it. */
  access: AdminPreprodAccess | null;
}

/**
 * Preprod access of one user or Organization: the flag, a switch that asks for
 * a reason, and the recent changes. Everything shown comes from the page's
 * read; after a change the page reads again.
 */
export function PreprodAccessSection({
  target,
  targetName,
  access,
}: PreprodAccessSectionProps) {
  const t = useTranslations("App.Admin.PreprodAccess");
  const formatter = useFormatter();
  const router = useRouter();
  const id = useId();
  const switchRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  // What the admin asked for, kept while the dialog is open.
  const [requested, setRequested] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [isPending, startTransition] = useTransition();

  const titleId = `${id}-title`;

  async function refreshPageData() {
    // Without a session the action declines; a plain refresh then sends the
    // reader to sign in.
    const refreshed = await refreshPage().catch(() => false);
    if (!refreshed) router.refresh();
  }

  function handleOpenChange(open: boolean) {
    if (open || isPending) {
      return;
    }
    setRequested(null);
    setReason("");
    setReasonError(undefined);
    setFailure(null);
  }

  function handleReasonChange(value: string) {
    setReason(value);
    if (value.trim()) {
      setReasonError(undefined);
    }
  }

  function handleConfirm(enabled: boolean) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setReasonError(t("dialog.reasonRequired"));
      reasonRef.current?.focus();
      return;
    }
    setReasonError(undefined);
    setFailure(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setAdminPreprodAccessAction>>;
      try {
        result = await setAdminPreprodAccessAction({
          target,
          enabled,
          reason: trimmedReason,
        });
      } catch {
        // The answer is lost and Core may have switched it: read again. An
        // answered action already rendered the page again itself.
        setFailure({ code: CommonErrorCode.INTERNAL_SERVER_ERROR });
        await refreshPageData();
        return;
      }
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      setRequested(null);
      setReason("");
      toast.success(t("saved", { enabled: String(result.value.enabled) }));
    });
  }

  function failureMessage(error: ActionError): string {
    switch (error.code) {
      case CommonErrorCode.UNAUTHORIZED:
        return t("errors.forbidden");
      case CommonErrorCode.NOT_FOUND:
        return t("errors.notFound", { type: target.type });
      case CommonErrorCode.BAD_INPUT:
        return t("errors.invalid");
      default:
        return t("errors.failed");
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className="bg-card-background space-y-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="font-medium">
            {t("title")}
          </h2>
          <p className="text-muted-foreground text-sm">{t("noEffect")}</p>
        </div>
        {access ? (
          <div className="flex items-center gap-2">
            <Switch
              ref={switchRef}
              aria-labelledby={titleId}
              checked={access.enabled}
              onCheckedChange={setRequested}
              disabled={isPending}
            />
            <span className="text-sm">
              {t("state", { enabled: String(access.enabled) })}
            </span>
          </div>
        ) : null}
      </div>

      {access ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("history.title")}</h3>
          {access.changes.length > 0 ? (
            <ol className="divide-y text-sm">
              {access.changes.map((change) => (
                <li key={change.id} className="space-y-1 py-2">
                  <p>
                    {t("history.entry", {
                      enabled: String(change.enabled),
                      operator: change.operator.name ?? t("history.unknown"),
                    })}
                    {" · "}
                    <time
                      dateTime={change.createdAt.toISOString()}
                      className="text-muted-foreground tabular-nums"
                    >
                      {formatter.dateTime(change.createdAt, "dateTimeWithYear")}
                    </time>
                  </p>
                  <p className="text-muted-foreground wrap-anywhere">
                    {change.reason}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("history.empty")}
            </p>
          )}
        </div>
      ) : (
        <LoadErrorState
          variant="banner"
          title={t("unavailable.title")}
          description={t("unavailable.description")}
          retryLabel={t("unavailable.retry")}
          retrying={isPending}
          onRetry={() => startTransition(refreshPageData)}
        />
      )}

      <Dialog open={requested !== null} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            switchRef.current?.focus();
          }}
        >
          {requested !== null ? (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                handleConfirm(requested);
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {t("dialog.title", { enabled: String(requested) })}
                </DialogTitle>
                <DialogDescription>
                  {t("dialog.description", {
                    enabled: String(requested),
                    type: target.type,
                    name: targetName,
                  })}
                </DialogDescription>
              </DialogHeader>
              <ReasonField
                ref={reasonRef}
                id={`${id}-reason`}
                label={t("dialog.reasonLabel")}
                hint={t("dialog.reasonHint")}
                value={reason}
                onChange={handleReasonChange}
                error={reasonError}
              />
              {failure ? (
                <p role="alert" className="text-destructive text-sm">
                  {failureMessage(failure)}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={isPending}
                >
                  {t("dialog.cancel")}
                </Button>
                <Button type="submit" loading={isPending}>
                  {t("dialog.confirm", { enabled: String(requested) })}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
