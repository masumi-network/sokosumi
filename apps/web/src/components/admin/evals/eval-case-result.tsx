import type { EvalResult } from "@sokosumi/core-client";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { EvalRepeatMarks, formatCost } from "./eval-marks";

interface ToolCall {
  capability: string;
  status: string;
}

function toolCalls(output: Record<string, unknown>): ToolCall[] {
  return Array.isArray(output.tools)
    ? output.tools.flatMap((call) =>
        call && typeof call === "object" && "capability" in call
          ? [
              {
                capability: String(call.capability),
                status: String((call as { status?: unknown }).status ?? ""),
              },
            ]
          : [],
      )
    : [];
}

/** The output fields worth reading, besides the answer and the tools. */
function details(output: Record<string, unknown>): [string, string][] {
  return Object.entries(output).flatMap(([key, value]) => {
    if (["answer", "tools", "turnStatus"].includes(key)) return [];
    if (value === null || value === undefined || value === "") return [];
    return [
      [
        key,
        Array.isArray(value)
          ? value.map(String).join("\n")
          : typeof value === "object"
            ? JSON.stringify(value, null, 2)
            : String(value),
      ],
    ];
  });
}

function Judge({ judge }: { judge: NonNullable<EvalResult["judge"]> }) {
  const t = useTranslations("App.Admin.Evals.Case");
  const issues = Array.isArray(judge.issues) ? judge.issues.map(String) : [];
  const scores =
    judge.scores && typeof judge.scores === "object"
      ? Object.entries(judge.scores as Record<string, unknown>)
      : [];
  return (
    <div className="space-y-1.5">
      <p className="text-sm">
        <span className="font-medium">
          {t("judge", { verdict: String(judge.verdict ?? "–") })}
        </span>
        {scores.length ? (
          <span className="text-muted-foreground ml-2 font-mono text-xs tabular-nums">
            {scores.map(([name, score]) => `${name} ${score}`).join(" · ")}
          </span>
        ) : null}
      </p>
      {judge.rationale ? (
        <p className="text-muted-foreground text-sm">
          {String(judge.rationale)}
        </p>
      ) : null}
      {issues.length ? (
        <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-sm">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One repeat of a case: its checks, the judge, and what it produced. */
export function EvalCaseResult({
  result,
  heading,
}: {
  result: EvalResult;
  heading: string;
}) {
  const t = useTranslations("App.Admin.Evals.Case");
  const answer =
    typeof result.output.answer === "string" ? result.output.answer : null;
  const tools = toolCalls(result.output);
  return (
    <article
      className={cn(HOLDER_ITEM_CLASS, "flex min-w-0 flex-col gap-4 p-4")}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <EvalRepeatMarks states={[result.status]} />
          {heading}
        </h3>
        <p className="text-muted-foreground text-xs tabular-nums">
          {[
            result.durationMs === null
              ? null
              : t("seconds", { seconds: Math.round(result.durationMs / 1000) }),
            formatCost(result.costUsd),
            result.turnId ? `turn ${result.turnId.slice(0, 8)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {result.error ? (
        <p className="border-foreground rounded-md border border-dashed px-3 py-2 text-sm">
          {result.error}
        </p>
      ) : null}

      {result.checks.length ? (
        <ul className="space-y-1">
          {result.checks.map((check) => (
            <li key={check.label} className="flex gap-2 text-sm">
              {check.pass ? (
                <Check
                  aria-label={t("passed")}
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                />
              ) : (
                <X
                  aria-label={t("failed")}
                  className="mt-0.5 size-4 shrink-0"
                />
              )}
              <span className="min-w-0">
                <span className={cn(!check.pass && "font-medium")}>
                  {check.label}
                </span>
                {!check.pass || check.actual.length < 80 ? (
                  <span className="text-muted-foreground block break-words text-xs">
                    {check.actual}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {result.judge ? <Judge judge={result.judge} /> : null}

      {answer ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">
            {t("answer")}
          </p>
          <p className="bg-muted rounded-md px-3 py-2 text-sm break-words whitespace-pre-wrap">
            {answer}
          </p>
        </div>
      ) : null}

      {tools.length ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">
            {t("tools")}
          </p>
          <ol className="flex flex-wrap gap-1">
            {tools.map((call, index) => (
              <li
                key={index}
                className={cn(
                  "rounded-md border px-2 py-0.5 font-mono text-xs",
                  call.status === "FAILED" && "border-foreground border-dashed",
                )}
              >
                {call.capability}
                {call.status === "FAILED" ? ` · ${t("toolFailed")}` : ""}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {details(result.output).map(([key, value]) => (
        <div key={key} className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">{key}</p>
          <p className="text-sm break-words whitespace-pre-wrap">{value}</p>
        </div>
      ))}
    </article>
  );
}
