const SUMMARY_TRUNCATE_THRESHOLD = 120;
const SUMMARY_TRUNCATE_LENGTH = 100;

interface AgentSummaryProps {
  summary: string;
}

export default function AgentSummary({ summary }: AgentSummaryProps) {
  const shouldTruncate = summary.length > SUMMARY_TRUNCATE_THRESHOLD;
  const truncatedSummary = (() => {
    if (!shouldTruncate) {
      return summary;
    }

    const slice = summary.slice(0, SUMMARY_TRUNCATE_LENGTH);
    const lastSpaceIndex = slice.lastIndexOf(" ");

    const safeSlice =
      lastSpaceIndex > 0 ? slice.slice(0, lastSpaceIndex) : slice;

    return `${safeSlice}...`;
  })();

  return (
    <div className="text-muted-foreground text-sm">{truncatedSummary}</div>
  );
}
