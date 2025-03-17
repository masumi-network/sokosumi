import { AgentsSkeleton } from "@/components/agents";

export default function GalleryLoading() {
  return (
    <div className="w-full p-8 xl:px-16">
      <div className="space-y-12">
        {/* Agent Cards Grid Skeleton */}
        <AgentsSkeleton />
      </div>
    </div>
  );
}
