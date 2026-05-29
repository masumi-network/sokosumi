import Markdown from "@/components/markdown";

interface ProjectDescriptionProps {
  title: string;
  description?: string | null;
  emptyLabel: string;
}

export function ProjectDescription({
  title,
  description,
  emptyLabel,
}: ProjectDescriptionProps) {
  const content = description?.trim() || null;

  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>
      {content ? (
        <Markdown className="text-foreground/80">{content}</Markdown>
      ) : (
        <p className="text-muted-foreground/40 text-sm">{emptyLabel}</p>
      )}
    </section>
  );
}
