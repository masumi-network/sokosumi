import { AgentsSkeleton } from "@/components/agents";

export default function GalleryLoading() {
  return (
    <div className="w-full">
      <div className="space-y-12">
        {/* Agent Cards Grid Skeleton */}
        <AgentsSkeleton />
      </div>
    </div>
  );
}
