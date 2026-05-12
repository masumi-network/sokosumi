"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewMode: boolean;
  onDestroy: () => Promise<void> | void;
}

export default function SettingsPanel({
  open,
  onOpenChange,
  onDestroy,
}: SettingsPanelProps) {
  const t = useTranslations("App.Hermes.Settings");

  const [destroyPending, startDestroyTransition] = useTransition();

  const handleDestroy = () => {
    startDestroyTransition(async () => {
      await onDestroy();
      onOpenChange(false);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-8 px-4 py-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-foreground text-sm font-medium">
              {t("modelSection")}
            </h3>
            <div className="border-border/60 bg-muted/20 flex flex-col gap-2 rounded-md border px-3 py-3">
              <ReadOnlyField
                label={t("modelLabel")}
                value="claude-sonnet-4.6"
                mono
              />
              <ReadOnlyField
                label={t("modelProviderLabel")}
                value="OpenRouter (managed)"
              />
              <p className="text-tertiary-foreground text-xs leading-relaxed">
                {t("modelManagedHelp")}
              </p>
            </div>
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <h3 className="text-destructive text-sm font-medium">
              {t("dangerSection")}
            </h3>
            <div className="border-destructive/30 flex flex-col gap-3 rounded-md border px-3 py-3">
              <div className="flex flex-col gap-1">
                <span className="text-foreground text-sm font-medium">
                  {t("destroyTitle")}
                </span>
                <p className="text-tertiary-foreground text-xs leading-relaxed">
                  {t("destroyBody")}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2 self-start"
                    disabled={destroyPending}
                  >
                    {destroyPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-4" aria-hidden />
                    )}
                    {t("destroyCta")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("destroyTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("destroyBody")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={destroyPending}>
                      {t("cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDestroy}
                      disabled={destroyPending}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      {t("destroyCta")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-tertiary-foreground text-xs">{label}</span>
      <span
        className={
          mono
            ? "text-foreground font-mono text-sm tabular-nums"
            : "text-foreground text-sm"
        }
      >
        {value}
      </span>
    </div>
  );
}
