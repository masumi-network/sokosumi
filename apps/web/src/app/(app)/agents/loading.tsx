import { AGENT_TILE_GRID_CLASS } from "@/components/agents/directory/agent-tile";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <div className="flex w-full flex-col gap-12 pb-12 md:px-2 md:pt-2">
      <div className="flex flex-col gap-2 px-1">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>
      {Array.from({ length: 3 }, (_, section) => (
        <div key={section} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 px-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className={HOLDER_CLASS}>
            <div className={AGENT_TILE_GRID_CLASS}>
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-32 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
