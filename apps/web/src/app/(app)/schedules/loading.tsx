import { Skeleton } from "@/components/ui/skeleton";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function SchedulesLoading() {
  return (
    <div className="flex w-full flex-col gap-4 pb-6" aria-busy>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
