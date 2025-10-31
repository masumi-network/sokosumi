import { AgentsSkeleton } from "@/components/agents";

import { CategoryHeadingSkeleton } from "./components/filtered-agents";

export default function GalleryLoading() {
  return (
    <div className="w-full">
      <div className="flex flex-col gap-12">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-4">
            <CategoryHeadingSkeleton />
            <AgentsSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
