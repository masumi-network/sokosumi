import { cn } from "@/lib/utils";

interface ColumnHeaderProps {
  title: string;
  count: number;
  statusColorClass: string;
}

export function ColumnHeader({
  title,
  count,
  statusColorClass,
}: ColumnHeaderProps) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className={cn("size-2 shrink-0 rounded-full", statusColorClass)}
          aria-hidden
        />
        <h2 className="text-foreground/70 text-xs font-semibold tracking-wide uppercase">
          {title}
        </h2>
      </div>
      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
        {count}
      </span>
    </header>
  );
}
