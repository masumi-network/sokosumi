import Markdown from "@/components/markdown";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";

interface TaskDescriptionProps {
  title: string;
  description?: string | null;
  // Map keeps mention lookups O(1) while parsing.
  agentNameById?: Map<string, string>;
}

export function TaskDescription({
  title,
  description,
  agentNameById = new Map<string, string>(),
}: TaskDescriptionProps) {
  const content = description
    ? formatMentionsAsMarkdownLinks(description, agentNameById)
    : "—";

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Markdown className="prose-sm text-muted-foreground leading-6">
        {content}
      </Markdown>
    </div>
  );
}
