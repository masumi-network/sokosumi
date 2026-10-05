import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function SchedulesLoading() {
  return (
    <div className="flex w-full flex-col gap-4 pb-6" aria-busy>
      <Skeleton className="h-9 w-full max-w-72" />
      <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
        {Array.from({ length: 12 }, (_, index) => (
          <div className={cn(HOLDER_ITEM_CLASS, "p-3")} key={index}>
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
