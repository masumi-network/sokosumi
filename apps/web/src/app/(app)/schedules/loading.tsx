import { Skeleton } from "@/components/ui/skeleton";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function SchedulesLoading() {
  return (
    <div className="flex w-full flex-col gap-4 pb-6" aria-busy>
      <Skeleton className="h-9 w-full max-w-72" />
      <div className="bg-card-background flex flex-col gap-2 rounded-xl p-2">
        {Array.from({ length: 12 }, (_, index) => (
          <div
            className="bg-background rounded-lg border border-border p-3"
            key={index}
          >
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
