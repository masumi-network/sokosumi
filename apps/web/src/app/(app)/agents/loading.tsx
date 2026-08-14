import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <div className="w-full">
      <div className="space-y-16 pb-8 md:space-y-24 md:px-2">
        <section className="space-y-8">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56 md:h-8" />
            <Skeleton className="h-4 w-80 md:h-5" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
