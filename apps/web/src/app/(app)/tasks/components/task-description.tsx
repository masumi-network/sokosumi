import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";
import { extractTaskAttachmentUrls } from "@/lib/utils/task-attachments";

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
  const attachmentUrls = content ? extractTaskAttachmentUrls(content) : [];

  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>
      {content ? (
        <div className="space-y-2">
          <ExpandableMarkdown
            content={content}
            className="text-foreground/80"
            expandLabel={expandLabel}
            collapseLabel={collapseLabel}
            fadeClassName="to-background"
          />
          {attachmentUrls.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {attachmentUrls.map((url) => (
                <FileChipMiniPreviewWithMetadata key={url} url={url} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground/40 text-sm">—</p>
      )}
    </section>
  );
}
