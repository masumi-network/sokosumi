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
    <div className="flex items-center justify-center py-4">
      <span className="text-muted-foreground rounded-full bg-gray-200 px-3 py-1 text-xs font-medium dark:bg-gray-900">
        {formatDaySeparator(date)}
      </span>
    </div>
  );
}
