"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { startImpersonation } from "@/lib/api/admin-impersonation";

interface ImpersonateUserDialogProps {
  userId: string;
  name: string;
  email: string;
}

/**
 * Per-row Impersonate action for the admin user overview. The confirm step
 * collects the required audit reason; on success the browser reloads at home
 * under the impersonated session.
 */
export function ImpersonateUserDialog({
  userId,
  name,
  email,
}: ImpersonateUserDialogProps) {
  const t = useTranslations("App.Admin.Users.Impersonate");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setReason("");
    }
  }

  async function handleStart() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await startImpersonation({
        userId,
        reason: trimmedReason,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("startError"));
        return;
      }
      // Full reload: the session switched under every client cache.
      window.location.assign("/");
    } finally {
      setIsSubmitting(false);
    }
  }

  const reasonId = `impersonate-reason-${userId}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name, email })}
          </DialogDescription>
        </DialogHeader>
        <ReasonField
          id={reasonId}
          label={t("reasonLabel")}
          value={reason}
          onChange={setReason}
          placeholder={t("reasonPlaceholder")}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleStart}
            disabled={isSubmitting || !reason.trim()}
          >
            {t("start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
