import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

import { formatRedactedValue, summarizeProposal } from "./proposal-summary";

interface DecisionProposalProps {
  toolName: string;
  proposal: unknown;
  className?: string;
}

/**
 * What the user is actually approving: typed proposal fields (agent, credit
 * ceiling, inputs, task target…) with credential-looking keys masked, plus a
 * bounded redacted remainder. Server component.
 */
export async function DecisionProposal({
  toolName,
  proposal,
  className,
}: DecisionProposalProps) {
  const t = await getTranslations("Components.SokoBot.Proposal");
  const summary = summarizeProposal(toolName, proposal);
  const empty = summary.fields.length === 0 && summary.raw === null;

  return (
    <div className={cn("space-y-2", className)}>
      {empty ? (
        <p className="text-muted-foreground text-xs">{t("empty")}</p>
      ) : null}
      {summary.fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {summary.fields.map((field) => (
            <div key={field.key} className="contents">
              <dt className="text-muted-foreground">
                {t(`fields.${field.key}`)}
              </dt>
              <dd
                className={cn(
                  "text-foreground min-w-0 break-words",
                  field.mono && "font-mono",
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {summary.raw !== null ? (
        <p className="text-muted-foreground break-words font-mono text-xs">
          {formatRedactedValue(summary.raw)}
        </p>
      ) : null}
      {!summary.acceptable ? (
        <p role="status" className="text-semantic-warning text-xs">
          {t("incomplete")}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">{t("redactionNote")}</p>
    </div>
  );
}
