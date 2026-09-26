import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="space-y-5" aria-label="Loading calendar">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-10 w-full" />
      <div className="bg-card-background rounded-xl p-2">
        <div className="bg-background rounded-lg border border-border p-3">
          <Skeleton className="h-140 w-full" />
        </div>
      </div>
    </div>
  );
}
