import { AgentCardSkeleton, AgentsSkeleton } from "@/components/agents";

export default function GalleryLoading() {
  return (
    <div className="container mx-auto px-4 pt-4 pb-8 md:px-12">
      <div className="space-y-12">
        {/* Featured Agent Skeleton */}
        <AgentCardSkeleton size="lg" />

        {/* Agent Cards Grid Skeleton */}
        <AgentsSkeleton />
      </div>
    </div>
  );
}
