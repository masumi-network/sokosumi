"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteSokoBotAction } from "@/lib/actions/soko-bot/action";

/**
 * Deletion is irreversible and distinct from Archive, so it asks the owner to
 * type their assistant's name before it arms.
 */
export function DeleteSokoBotButton({ botName }: { botName: string | null }) {
  const t = useTranslations("App.SokoBot.Settings");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const expected = botName?.trim() ?? "";
  const armed =
    expected.length === 0 ||
    confirmation.trim().toLowerCase() === expected.toLowerCase();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSokoBotAction({});
      if (!result.ok) {
        toast.error(result.error.message ?? t("deleteError"));
        return;
      }
      setOpen(false);
      toast.success(t("deleted"));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          {t("delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("deleteConfirmDescription")}</DialogDescription>
        </DialogHeader>
        {expected ? (
          <div className="space-y-2">
            <Label htmlFor="delete-soko-bot-confirmation">
              {t("deleteConfirmLabel", { name: expected })}
            </Label>
            <Input
              id="delete-soko-bot-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t("deleteCancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!armed || pending}
            onClick={handleDelete}
          >
            {pending ? t("deleting") : t("deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
