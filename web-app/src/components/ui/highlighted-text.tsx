import { cn } from "@/lib/utils";

const MAX_HIGHLIGHT_LENGTH = 100;

interface HighlightedTextProps {
  text: string;
  query?: string;
  className?: string;
  truncate?: boolean;
}

export function HighlightedText({
  text,
  query,
  className,
  truncate = false,
}: HighlightedTextProps) {
  const q = (query ?? "").trim();

  // No highlighting if query is empty or too long
  if (!q || q.length > MAX_HIGHLIGHT_LENGTH) {
    return renderNoHighlight(text, truncate, className);
  }

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const index = lower.indexOf(qLower);

  // No match found
  if (index === -1) {
    return renderNoHighlight(text, truncate, className);
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + q.length);
  const after = text.slice(index + q.length);

  return (
    <span className={cn(truncate && "inline-flex w-full", className)}>
      <span className="truncate">
        {before && <span>{before}</span>}
        <mark className="bg-primary/50 text-foreground rounded-sm px-0.5">
          {match}
        </mark>
        {after && <span>{after}</span>}
      </span>
    </span>
  );
}

function renderNoHighlight(text: string, truncate: boolean, className?: string) {
  return (
    <span className={cn(truncate && "inline-flex w-full", className)}>
      <span className={cn(truncate && "truncate")}>{text}</span>
    </span>
  );
}