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
    return (
      <span className={cn(truncate && "truncate", className)}>{text}</span>
    );
  }

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const index = lower.indexOf(qLower);

  // No match found
  if (index === -1) {
    return (
      <span className={cn(truncate && "truncate", className)}>{text}</span>
    );
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + q.length);
  const after = text.slice(index + q.length);

  return (
    <span className={cn(truncate && "truncate", className)}>
      {before && <span>{before}</span>}
      <mark className="bg-primary/50 text-foreground rounded-sm px-0.5">
        {match}
      </mark>
      {after && <span>{after}</span>}
    </span>
  );
}