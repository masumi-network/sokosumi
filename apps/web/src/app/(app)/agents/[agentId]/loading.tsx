import { AgentDetailSkeleton } from "@/components/agents";

export default function AgentDetailLoading() {
  return (
    <div className="mx-auto flex justify-center py-8 md:px-2 md:py-2">
      <AgentDetailSkeleton />
    </div>
  );
}
