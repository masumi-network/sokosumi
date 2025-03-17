import { AgentsSkeleton } from "@/components/agents";

export default function GalleryLoading() {
  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="space-y-12">
        {/* Agent Cards Grid Skeleton */}
        <AgentsSkeleton className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3" />
      </div>
    </div>
  );
}
