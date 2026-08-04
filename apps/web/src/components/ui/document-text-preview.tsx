import { FileText } from "lucide-react";

import Markdown from "@/components/markdown";
import { cn } from "@/lib/utils";

/**
 * Renders plain text/markdown content as a real document "page" — a titled
 * sheet with document-grade typography, not a cramped markdown blob. Shared
 * by the offer preview's inline text output and the attachment DocumentViewer's
 * fetched text/markdown files, so both render identically.
 */
export function DocumentTextPreview({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div className="bg-muted/40 h-full w-full overflow-y-auto p-4 md:p-6">
      <article className="bg-background border-border/70 mx-auto max-w-2xl overflow-hidden rounded-xl border shadow-md">
        {/* Document letterhead */}
        <div className="border-border/60 flex items-center gap-2.5 border-b px-7 py-3.5 md:px-10">
          <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
            <FileText className="size-4" aria-hidden />
          </span>
          <p className="text-foreground truncate text-sm font-medium">
            {title}
          </p>
        </div>
        {/* Document body */}
        <div className="px-7 py-7 md:px-10 md:py-9">
          <Markdown
            className={cn(
              "prose-h2:text-xl prose-h2:mb-3 prose-h2:tracking-tight",
              "prose-h3:text-foreground prose-h3:mt-7 prose-h3:mb-2 prose-h3:text-base",
              "prose-p:text-foreground/90 prose-p:text-[15px] prose-p:leading-7",
              "prose-li:text-foreground/90 prose-li:my-1.5 prose-li:text-[15px] prose-li:leading-7",
              "prose-ul:my-3 prose-ol:my-3 prose-strong:text-foreground",
            )}
          >
            {content}
          </Markdown>
        </div>
      </article>
    </div>
  );
}
