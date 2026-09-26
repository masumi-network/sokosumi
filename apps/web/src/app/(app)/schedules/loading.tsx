import { Skeleton } from "@/components/ui/skeleton";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function SchedulesLoading() {
  return (
    <div className="flex w-full flex-col gap-4 pb-6" aria-busy>
      <Skeleton className="h-9 w-72" />
      <div className="bg-card-background grid gap-4 rounded-xl p-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton className="h-44 w-full rounded-xl" key={index} />
        ))}
      </div>
    </div>
  );
}
