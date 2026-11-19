"use client";

import type { SocialAccountChoice } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

interface SocialAccountChoiceDialogProps {
  choices: SocialAccountChoice[];
  /** The network's name, as the sign-in showed it. */
  provider: string;
  isConnecting: boolean;
  onChoose: (accountChoiceId: string) => void;
  onCancel: () => void;
}

/**
 * One sign-in reaches several accounts: a person's LinkedIn Pages and their own
 * profile, or the Facebook Pages a login manages. The person picks the one
 * posts go out as. Pages come first and nothing is preselected, so a company
 * never posts as a person by default. Mounted only while a pick is open.
 */
export function SocialAccountChoiceDialog({
  choices,
  provider,
  isConnecting,
  onChoose,
  onCancel,
}: SocialAccountChoiceDialogProps) {
  const t = useTranslations("App.Projects.ProjectSocialAccounts");
  const [selected, setSelected] = useState<string | null>(null);
  const ordered = [
    ...choices.filter((choice) => choice.kind === "page"),
    ...choices.filter((choice) => choice.kind === "profile"),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isConnecting) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("choose.title")}</DialogTitle>
          <DialogDescription>
            {t("choose.description", { provider })}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          aria-label={t("choose.listLabel")}
          value={selected ?? ""}
          onValueChange={setSelected}
          className="app-scrollbar -mx-1 flex max-h-72 flex-col gap-2 overflow-y-auto px-1 py-1"
        >
          {ordered.map((choice) => {
            const id = `social-account-choice-${choice.id}`;
            return (
              <label
                key={choice.id}
                htmlFor={id}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors",
                  selected === choice.id
                    ? "border-foreground bg-muted"
                    : "hover:bg-quinary",
                )}
              >
                <RadioGroupItem
                  value={choice.id}
                  id={id}
                  disabled={isConnecting}
                />
                <span className="min-w-0">
                  {/* Wraps: the end of a long name can be what tells two Pages apart. */}
                  <span className="block text-sm font-medium wrap-anywhere">
                    {choice.name}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {choice.kind === "page"
                      ? t("choose.page")
                      : t("choose.profile")}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>

        <DialogFooter>
          <Button
            disabled={isConnecting}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            {t("choose.cancel")}
          </Button>
          <Button
            disabled={selected === null}
            loading={isConnecting}
            onClick={() => {
              if (selected) onChoose(selected);
            }}
            type="button"
            variant="primary"
          >
            {t("choose.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
