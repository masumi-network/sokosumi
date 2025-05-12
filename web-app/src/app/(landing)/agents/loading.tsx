import { AgentCardSkeleton, AgentsSkeleton } from "@/components/agents";

export default function GalleryLoading() {
  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="space-y-12">
        {/* Featured Agent Skeleton */}
        <AgentCardSkeleton size="lg" />

        {/* Agent Cards Grid Skeleton */}
        <AgentsSkeleton className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" />
      </div>
    </div>
  );
}
