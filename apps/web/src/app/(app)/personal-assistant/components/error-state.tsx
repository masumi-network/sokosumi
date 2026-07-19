"use client";

import { AlertCircle, RotateCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

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

interface ErrorStateProps {
  onRetry: () => void;
  /**
   * When set, the screen offers a confirmed "Start over" that destroys the
   * stuck instance and returns to the landing page. Wired only when an
   * instance actually exists in `error` status — an orchestrator-side
   * failure can leave it stuck there forever, and Retry (a plain refetch)
   * can never recover from that on its own.
   */
  onStartOver?: () => Promise<void> | void;
  message?: string;
}

export default function ErrorState({
  onRetry,
  onStartOver,
  message,
}: ErrorStateProps) {
  const t = useTranslations("App.Hermes.Error");
  const tSettings = useTranslations("App.Hermes.Settings");
  const [startingOver, setStartingOver] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-4 py-16 text-center md:py-24">
      <div className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
        <AlertCircle className="size-6" aria-hidden />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-foreground text-2xl font-light tracking-tight">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {message ?? t("description")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onRetry} variant="outline" className="gap-2">
          <RotateCw className="size-4" aria-hidden />
          {t("retry")}
        </Button>
        {onStartOver ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive gap-2"
                disabled={startingOver}
              >
                <Trash2 className="size-4" aria-hidden />
                {t("startOver")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tSettings("destroyTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tSettings("destroyBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={startingOver}>
                  {tSettings("cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={startingOver}
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => {
                    setStartingOver(true);
                    void Promise.resolve(onStartOver()).finally(() =>
                      setStartingOver(false),
                    );
                  }}
                >
                  {t("startOver")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}
