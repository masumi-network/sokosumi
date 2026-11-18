import type { ProjectCompetitorSignal } from "@sokosumi/core-client";
import { getFormatter } from "next-intl/server";

/**
 * Where a finding can be read: its publisher and date, linked to the source.
 * Every sentence on the page stands on one of these.
 */
export async function CompetitorsSource({
  signal,
}: {
  signal: Pick<
    ProjectCompetitorSignal,
    "sourceUrl" | "sourceTitle" | "sourcePublisher" | "observedAt"
  >;
}) {
  const format = await getFormatter();
  const label = [
    signal.sourcePublisher ?? signal.sourceTitle,
    format.dateTime(signal.observedAt, { day: "numeric", month: "short" }),
  ]
    .filter(Boolean)
    .join(", ");
  return signal.sourceUrl ? (
    <a
      className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
      href={signal.sourceUrl}
      rel="noopener noreferrer"
      target="_blank"
      title={signal.sourceTitle ?? undefined}
    >
      {label}
    </a>
  ) : (
    <span className="text-muted-foreground text-xs">{label}</span>
  );
}
