"use client";

interface DaySeparatorProps {
  date: Date;
  formatDaySeparator: (date: Date) => string;
}

export default function DaySeparator({
  date,
  formatDaySeparator,
}: DaySeparatorProps) {
  return (
    <div className="flex items-center justify-center pt-2 pb-1">
      <span className="text-muted-foreground bg-muted-foreground/10 rounded-full px-3 py-1 text-xs font-medium">
        {formatDaySeparator(date)}
      </span>
    </div>
  );
}
