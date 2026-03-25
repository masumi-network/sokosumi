"use client";

import { useTranslations } from "next-intl";

import { SokosumiLoader } from "@/components/ui/sokosumi-loader";

interface LoadingIndicatorProps {
  /** When provided, shown instead of "Thinking..." */
  label?: string;
}

export default function LoadingIndicator({ label }: LoadingIndicatorProps) {
  const t = useTranslations("App.Chat.Chat");
  const text = label ?? t("reasoning.thinking");

  return (
    <div className="flex min-h-11 items-start gap-3 px-4 py-1.5">
      <div className="size-8 shrink-0 overflow-hidden">
        <SokosumiLoader className="text-primary" size={32} />
      </div>
      <div className="flex min-h-5 items-start pt-1">
        <span className="reasoning-text-shine text-sm leading-5">{text}</span>
      </div>
    </div>
  );
}
