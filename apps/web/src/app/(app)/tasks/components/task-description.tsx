import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";

interface TaskDescriptionProps {
  title: string;
  description?: string | null;
  // Map keeps mention lookups O(1) while parsing.
  agentNameById?: Map<string, string>;
  expandLabel?: string;
  collapseLabel?: string;
}

export function TaskDescription({
  title,
  description,
  agentNameById = new Map<string, string>(),
  expandLabel = "Expand",
  collapseLabel = "Show less",
}: TaskDescriptionProps) {
  const content = description
    ? formatMentionsAsMarkdownLinks(description, agentNameById)
    : null;

  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>
      {content ? (
        <ExpandableMarkdown
          content={content}
          className="text-foreground/80"
          expandLabel={expandLabel}
          collapseLabel={collapseLabel}
          fadeClassName="to-background"
        />
      ) : (
        <p className="text-muted-foreground/40 text-sm">—</p>
      )}
    </section>
  );
}
