import { AgentDetailSkeleton } from "@/components/agents";

export default function Loading() {
  return (
    <div className="w-full space-y-8 px-4 py-4 sm:px-8 xl:px-16">
      <AgentDetailSkeleton />
    </div>
  );
}
