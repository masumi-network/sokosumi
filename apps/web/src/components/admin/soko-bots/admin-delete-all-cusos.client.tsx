"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAllAdminCusosAction } from "@/lib/actions/admin-soko-bots/action";

/**
 * Deletes every Cuso at once. Irreversible, so the operator types how many
 * there are, which also catches a fleet that changed since the page loaded.
 */
export function AdminDeleteAllCusos({
  count,
  onDeleted,
}: {
  count: number;
  onDeleted: () => void;
}) {
  const t = useTranslations("App.Admin.SokoBots.Fleet.deleteAllCusos");
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const armed = confirmation.trim() === String(count);

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAllAdminCusosAction({ input: { count } });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      const { deleted, failed } = result.value;
      if (failed > 0) toast.error(t("partly", { deleted, failed }));
      else toast.success(t("deleted", { count: deleted }));
      setOpen(false);
      setConfirmation("");
      onDeleted();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          {t("button", { count })}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { count })}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="admin-delete-all-cusos">
            {t("confirmLabel", { count })}
          </Label>
          <Input
            id="admin-delete-all-cusos"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("cancel")}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            loading={pending}
            disabled={!armed}
            onClick={handleDelete}
          >
            {t("confirm", { count })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
