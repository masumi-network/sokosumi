"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { MIN_CREDITS_PER_MONTH } from "@/components/admin/enterprise-contracts/contract-form";
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
import { updateEnterpriseContractAction } from "@/lib/actions/enterprise-contract/action";

interface ChangeCreditsPerMonthDialogProps {
  contractId: string;
  creditsPerMonth: number;
}

export function ChangeCreditsPerMonthDialog({
  contractId,
  creditsPerMonth,
}: ChangeCreditsPerMonthDialogProps) {
  const t = useTranslations("App.Admin.EnterpriseContracts.ChangeCredits");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(creditsPerMonth);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const result = await updateEnterpriseContractAction({
        id: contractId,
        body: { creditsPerMonth: value },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }

      toast.success(t("success"));
      setOpen(false);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t("title")}</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="changeCreditsPerMonth">{t("label")}</Label>
            <Input
              id="changeCreditsPerMonth"
              type="number"
              min={MIN_CREDITS_PER_MONTH}
              step={1}
              value={value}
              onChange={(event) =>
                setValue(Number(event.target.value) || MIN_CREDITS_PER_MONTH)
              }
              required
            />
            <p className="text-muted-foreground text-xs">
              {t("min", { min: MIN_CREDITS_PER_MONTH })}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
