"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const STEPS = ["stepName", "stepPicture", "stepConnect"] as const;

/** Where a new Soko Bot's setup stands: name, picture, then connect. */
export function SokoBotSetupSteps({ current }: { current: 1 | 2 | 3 }) {
  const t = useTranslations("App.SokoBot.Create");
  return (
    <ol
      aria-label={t("stepOf", { current, total: STEPS.length })}
      className="flex w-full items-center gap-2"
    >
      {STEPS.map((key, index) => {
        const step = index + 1;
        return (
          <li
            key={key}
            aria-current={step === current ? "step" : undefined}
            className="flex flex-1 flex-col gap-2"
          >
            <span
              className={cn(
                "h-1 rounded-full transition-colors duration-200",
                step <= current ? "bg-primary" : "bg-muted",
              )}
            />
            <span
              className={cn(
                "text-xs",
                step === current
                  ? "text-foreground font-medium"
                  : "text-muted-foreground",
              )}
            >
              {t(key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
