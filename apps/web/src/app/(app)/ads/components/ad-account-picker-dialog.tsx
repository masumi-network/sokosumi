"use client";

import type {
  AvailableAdAccount,
  ProjectAdProvider,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AdAccountPickerDialogProps {
  accounts: AvailableAdAccount[];
  isAttaching: boolean;
  onAttach: (externalAccountIds: string[]) => void;
  onCancel: () => void;
  provider: ProjectAdProvider;
}

/**
 * Lets the person choose which of a login's ad accounts this project manages.
 * Mounted only while a choice is open, so each connection starts fresh. A
 * login that reaches a single account has it preselected.
 */
export function AdAccountPickerDialog({
  accounts,
  isAttaching,
  onAttach,
  onCancel,
  provider,
}: AdAccountPickerDialogProps) {
  const t = useTranslations("App.Ads.accounts");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(accounts.length === 1 ? [accounts[0].externalAccountId] : []),
  );

  function handleToggle(externalAccountId: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(externalAccountId);
      else next.delete(externalAccountId);
      return next;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isAttaching) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("picker.title")}</DialogTitle>
          <DialogDescription>
            {t("picker.description", {
              provider: t(`providers.${provider}`),
            })}
          </DialogDescription>
        </DialogHeader>

        <ul
          aria-label={t("picker.listLabel")}
          className="app-scrollbar -mx-1 flex max-h-72 flex-col gap-1 overflow-y-auto px-1"
        >
          {accounts.map((account) => (
            <li key={account.externalAccountId}>
              <label className="hover:bg-quinary flex cursor-pointer items-start gap-3 rounded-md px-2 py-2">
                <Checkbox
                  checked={selected.has(account.externalAccountId)}
                  className="mt-0.5"
                  disabled={isAttaching}
                  onCheckedChange={(checked) =>
                    handleToggle(account.externalAccountId, checked === true)
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {account.name}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {account.externalAccountId} · {account.currency}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button
            disabled={isAttaching}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            {t("cancel")}
          </Button>
          <Button
            disabled={selected.size === 0 || isAttaching}
            onClick={() => onAttach([...selected])}
            type="button"
            variant="primary"
          >
            {isAttaching ? t("picker.confirming") : t("picker.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
