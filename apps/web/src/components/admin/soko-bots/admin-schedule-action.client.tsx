"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { performAdminSokoBotAction } from "@/lib/actions/admin-soko-bots/action";
import type { AdminSokoBotScheduleActionKind } from "@/lib/soko-bot/constants";
import { newOperationId } from "@/lib/soko-bot/operation-id";

interface AdminScheduleActionProps {
  sokoBotId: string;
  targetId: string;
  action: AdminSokoBotScheduleActionKind;
  disabled?: boolean;
}

/** Audited dead-letter retry and schedule disable controls. */
export function AdminScheduleAction({
  sokoBotId,
  targetId,
  action,
  disabled = false,
}: AdminScheduleActionProps) {
  const t = useTranslations("App.Admin.SokoBots.Schedules");
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const label =
    action === "RETRY_SCHEDULE_RUN" ? t("retryRun") : t("disableSchedule");

  function close() {
    if (isPending) return;
    setOpen(false);
    setOperationId(null);
    setReason("");
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await performAdminSokoBotAction({
        input: {
          sokoBotId,
          action,
          targetId,
          reason: reason.trim(),
          operationId: operationId ?? newOperationId(),
        },
      });
      if (!result.ok) {
        // Same operationId on retry keeps Core idempotent.
        toast.error(result.error.message ?? t("actionError"));
        return;
      }
      toast.success(t("actionDone"));
      setOpen(false);
      setOperationId(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={action === "DISABLE_SCHEDULE" ? "destructive" : "outline"}
        disabled={disabled || isPending}
        onClick={() => {
          setOperationId(newOperationId());
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value) setOpen(true);
          else close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{t("actionDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={reasonId}>{t("reasonLabel")}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={close}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant={
                action === "DISABLE_SCHEDULE" ? "destructive" : "default"
              }
              disabled={reason.trim().length < 3 || isPending}
              onClick={handleConfirm}
            >
              {isPending ? t("working") : label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
