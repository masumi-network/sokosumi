import { cn } from "@/lib/utils";

interface MiddleTruncateProps {
  text: string;
  className?: string;
  ellipsis?: string;
  startChars?: number;
  endChars?: number;
}

export function MiddleTruncate({
  text,
  className,
  ellipsis = "...",
  startChars = 6,
  endChars = 6,
}: MiddleTruncateProps) {
  if (text.length <= startChars + endChars) {
    return <span className={className}>{text}</span>;
  }

  const start = text.slice(0, startChars);
  const end = text.slice(-endChars);

  return (
    <span className={cn("inline-flex", className)} title={text}>
      <span>{start}</span>
      <span>{ellipsis}</span>
      <span>{end}</span>
    </span>
  );
}
