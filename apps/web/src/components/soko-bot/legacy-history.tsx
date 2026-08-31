import { getFormatter, getTranslations } from "next-intl/server";

import Markdown from "@/components/markdown";
import type { SokoBotLegacyMessage } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { formatDurationMs } from "./format";
import { normalizeLegacyRole, orderLegacyMessagesForDisplay } from "./legacy";
import { StatusBadge } from "./status-badge";

interface LegacyHistoryProps {
  messages: readonly SokoBotLegacyMessage[];
  /** Admin view adds ids/kind for support diagnostics. */
  diagnostics?: boolean;
  className?: string;
}

/**
 * Read-only conversation history imported from the previous assistant.
 * Rendered oldest-first with an explicit role rail. Step contents are never
 * shown (only their count) — they may contain provider reasoning.
 */
export async function LegacyHistory({
  messages,
  diagnostics = false,
  className,
}: LegacyHistoryProps) {
  const [t, format] = await Promise.all([
    getTranslations("Components.SokoBot.Legacy"),
    getFormatter(),
  ]);
  const ordered = orderLegacyMessagesForDisplay(messages);

  if (ordered.length === 0) {
    return (
      <p className={cn("text-muted-foreground text-sm", className)}>
        {t("empty")}
      </p>
    );
  }

  return (
    <ol className={cn("divide-y", className)}>
      {ordered.map((message) => {
        const role = normalizeLegacyRole(message.role);
        const steps = message.stepCount;
        const duration = formatDurationMs(message.durationMs);
        return (
          <li
            key={message.id}
            className={cn(
              "grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[6rem_minmax(0,1fr)]",
              role === "user" && "bg-muted/30",
            )}
          >
            <div className="space-y-1">
              <p
                className={cn(
                  "text-xs font-medium",
                  role === "user" ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`role.${role}`)}
              </p>
              <time
                dateTime={message.createdAt.toISOString()}
                className="text-muted-foreground block text-xs tabular-nums"
              >
                {format.dateTime(message.createdAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </time>
            </div>
            <div className="min-w-0 space-y-2">
              {role === "assistant" ? (
                <Markdown className="prose prose-sm dark:prose-invert max-w-none">
                  {message.content}
                </Markdown>
              ) : (
                <p className="whitespace-pre-wrap text-sm">{message.content}</p>
              )}
              {steps > 0 || duration || (diagnostics && message.kind) ? (
                <div className="flex flex-wrap items-center gap-2">
                  {steps > 0 ? (
                    <StatusBadge tone="neutral">
                      {t("steps", { count: steps })}
                    </StatusBadge>
                  ) : null}
                  {duration ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {duration}
                    </span>
                  ) : null}
                  {diagnostics && message.kind ? (
                    <span className="text-muted-foreground font-mono text-xs">
                      {message.kind}
                    </span>
                  ) : null}
                  {diagnostics ? (
                    <span className="text-muted-foreground font-mono text-xs">
                      {message.id}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
