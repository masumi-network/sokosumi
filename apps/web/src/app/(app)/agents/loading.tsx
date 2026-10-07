import { AgentsSkeleton } from "@/components/agents/agents";
import { GALLERY_PAGE_SECTIONS_CLASS } from "@/components/agents/gallery-page-classes";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <div className="w-full">
      <div className={GALLERY_PAGE_SECTIONS_CLASS}>
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
        <section className="space-y-8">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48 md:h-8" />
            <Skeleton className="h-4 w-72 md:h-5" />
          </div>
          <AgentsSkeleton />
        </section>
      </div>
    </div>
  );
}
