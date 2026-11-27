"use client";

import type { AdminPreprodAccess } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { ReasonField } from "@/components/admin/reason-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type PreprodAccessTarget,
  setAdminPreprodAccessAction,
} from "@/lib/actions/admin-preprod-access/action";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

interface PreprodAccessSectionProps {
  target: PreprodAccessTarget;
  /** The user's or Organization's name, as the dialog names it. */
  targetName: string;
  access: AdminPreprodAccess;
}

/**
 * Preprod access of one user or Organization: the flag, a switch that asks for
 * a reason, and the recent changes. The switch shows only what Core accepted.
 */
export function PreprodAccessSection({
  target,
  targetName,
  access: initialAccess,
}: PreprodAccessSectionProps) {
  const t = useTranslations("App.Admin.PreprodAccess");
  const formatter = useFormatter();
  const id = useId();
  const [access, setAccess] = useState(initialAccess);
  const [requested, setRequested] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [isPending, startTransition] = useTransition();

  const titleId = `${id}-title`;
  const switchId = `${id}-switch`;

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
        setFailure({ code: CommonErrorCode.INTERNAL_SERVER_ERROR });
        return;
      }
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      setAccess(result.value);
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
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={access.enabled}
            onCheckedChange={setRequested}
            disabled={isPending}
          />
          <Label htmlFor={switchId}>
            {t("state", { enabled: String(access.enabled) })}
          </Label>
        </div>
      </div>

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
          <p className="text-muted-foreground text-sm">{t("history.empty")}</p>
        )}
      </div>

      <Dialog open={requested !== null} onOpenChange={handleOpenChange}>
        <DialogContent>
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
                id={`${id}-reason`}
                label={t("dialog.reasonLabel")}
                hint={t("dialog.reasonHint")}
                value={reason}
                onChange={handleReasonChange}
                error={reasonError}
              />
              {failure ? (
                <div role="alert" className="space-y-1 text-sm">
                  <p className="text-destructive">{failureMessage(failure)}</p>
                  {failure.message ? (
                    <p className="text-muted-foreground wrap-anywhere">
                      {failure.message}
                    </p>
                  ) : null}
                </div>
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
