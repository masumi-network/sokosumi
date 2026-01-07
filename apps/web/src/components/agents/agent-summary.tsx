interface AgentSummaryProps {
  summary: string;
}

export default function AgentSummary({ summary }: AgentSummaryProps) {
  return (
    <div className="text-muted-foreground line-clamp-3 text-sm">{summary}</div>
  );
}
