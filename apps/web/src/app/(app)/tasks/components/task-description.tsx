import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";

import { ExpandableMarkdown } from "./expandable-markdown";

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
    : "—";

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ExpandableMarkdown
        content={content}
        className="prose-sm text-muted-foreground leading-6"
        expandLabel={expandLabel}
        collapseLabel={collapseLabel}
        fadeClassName="to-transparent"
      />
    </div>
  );
}
