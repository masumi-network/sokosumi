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
    <header className="flex items-center gap-2">
      <span
        className={cn("size-2.5 shrink-0 rounded-full", statusColorClass)}
        aria-hidden
      />
      <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-semibold uppercase">
        <span>{title}</span>
        <span className="text-muted-foreground/80 text-xs">{count}</span>
      </h2>
    </header>
  );
}
