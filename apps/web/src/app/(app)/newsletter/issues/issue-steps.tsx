import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { getToneStyle } from "@/components/ui/status-marker";
import { cn } from "@/lib/utils";
import { ISSUE_STEPS } from "./issue-flow";

const DONE = getToneStyle({ hue: "resolved", weight: "filled" });
const CURRENT = getToneStyle({ hue: "active", weight: "filled" });
const FAULT = getToneStyle({ hue: "fault", weight: "solid" });

/** Progress strip: Write → Review → Approve → Send. It shows, it does not navigate. */
export function IssueSteps({
  current,
  failed = false,
}: {
  /** Index into `ISSUE_STEPS`; its length marks every step done. */
  current: number;
  failed?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues.Flow");
  return (
    <ol aria-label={t("label")} className="grid grid-cols-4 gap-1 px-1 pt-1">
      {ISSUE_STEPS.map((step, index) => {
        const state =
          index < current ? "done" : index === current ? "current" : "next";
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className="flex min-w-0 flex-col items-center gap-1.5 px-1 py-1.5 text-center sm:flex-row sm:gap-2 sm:px-2 sm:text-start"
          >
            <span
              aria-hidden
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                state === "done" && [DONE.disc, DONE.mark],
                state === "current" &&
                  (failed
                    ? [FAULT.box, FAULT.mark]
                    : [CURRENT.disc, CURRENT.mark]),
                state === "next" &&
                  "border-border text-muted-foreground border",
              )}
            >
              {state === "done" ? (
                <Check className="size-3.5" strokeWidth={2.75} />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn(
                "min-w-0 text-xs font-medium wrap-anywhere sm:text-sm",
                state === "next" && "text-muted-foreground",
              )}
            >
              {t(`steps.${step}`)}
              {state === "done" ? (
                <span className="sr-only">: {t("done")}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
