"use client";

import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface TaskCreateProgressProps {
  /** True while the create request is out. */
  active: boolean;
  /** No name was typed, so Core names the Task from its details first. */
  needsName: boolean;
  /** Tags were suggested while typing; Core reuses them. */
  tagsReady: boolean;
  /** A copy takes its name and tags from the source Task. */
  isCopy: boolean;
}

/**
 * What one create request does, in Core's order: name, tags, then save.
 * Only steps already finished in the browser are ticked; the request reports
 * nothing until the Task is saved, so the rest show as still to come.
 */
export function TaskCreateProgress({
  active,
  needsName,
  tagsReady,
  isCopy,
}: TaskCreateProgressProps) {
  const t = useTranslations("App.Tasks.NewTask.Progress");
  const steps = [
    ...(needsName && !isCopy ? [{ label: t("naming"), done: false }] : []),
    ...(isCopy
      ? []
      : [
          { label: tagsReady ? t("tagsReady") : t("tagging"), done: tagsReady },
        ]),
    { label: t("saving"), done: false },
  ];

  // The live region stays mounted, so its text is announced when it fills.
  return (
    <div role="status">
      {active ? (
        <div className="flex flex-col gap-2 border-t px-6 py-3 text-sm md:px-8">
          <p className="flex items-center gap-2 font-medium">
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            {t("title")}
          </p>
          <ol className="text-muted-foreground flex flex-col gap-1 pl-6">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-2">
                {step.done ? (
                  <Check className="text-foreground size-3.5" aria-hidden />
                ) : (
                  <span
                    className="bg-muted-foreground mx-1 size-1.5 rounded-full"
                    aria-hidden
                  />
                )}
                <span className={step.done ? "text-foreground" : undefined}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground text-xs">{t("keepOpen")}</p>
        </div>
      ) : null}
    </div>
  );
}
