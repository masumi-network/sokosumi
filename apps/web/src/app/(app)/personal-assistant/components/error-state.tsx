"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  onRetry: () => void;
  message?: string;
}

export default function ErrorState({ onRetry, message }: ErrorStateProps) {
  const t = useTranslations("App.Hermes.Error");

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
      <Button onClick={onRetry} variant="outline" className="gap-2">
        <RotateCw className="size-4" aria-hidden />
        {t("retry")}
      </Button>
    </div>
  );
}
