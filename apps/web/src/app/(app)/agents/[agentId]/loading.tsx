import { AgentDetailSkeleton } from "@/components/agents";

export default function AgentDetailLoading() {
  return (
    <div className="mx-auto flex justify-center py-2 md:px-4 md:py-8">
      <AgentDetailSkeleton />
    </div>
  );
}
