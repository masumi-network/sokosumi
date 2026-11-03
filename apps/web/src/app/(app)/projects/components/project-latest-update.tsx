import { CollapsibleSectionMarkdown } from "@/app/projects/components/collapsible-section-markdown";

interface ProjectLatestUpdateProps {
  title: string;
  content: string;
  showMoreLabel: string;
  showLessLabel: string;
}

export function ProjectLatestUpdate({
  title,
  content,
  showMoreLabel,
  showLessLabel,
}: ProjectLatestUpdateProps) {
  return (
    <section className="space-y-2" data-testid="project-latest-update">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      <CollapsibleSectionMarkdown
        id="project-latest-update-content"
        content={content}
        showMoreLabel={showMoreLabel}
        showLessLabel={showLessLabel}
      />
    </section>
  );
}
