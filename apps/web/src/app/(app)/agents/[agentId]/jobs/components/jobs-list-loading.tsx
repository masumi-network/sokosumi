import { Skeleton } from "@/components/ui/skeleton";

export default function JobsListLoading() {
  return (
    <aside className="lg:border-border h-full w-full py-4 lg:w-72 lg:border-r">
      <div className="pr-4 pb-2">
        <Skeleton className="h-10 w-full rounded-md" />
      </div>

      <div className="space-y-4 p-2 pr-4 pl-0">
        <section className="space-y-2">
          <Skeleton className="h-3 w-16" />
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`group-skeleton-${index}`}
              className="space-y-2 px-2 py-2"
            >
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
