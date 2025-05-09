import { AgentDetailSkeleton } from "@/components/agents";

export default function AgentDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl p-4 pb-8">
      <AgentDetailSkeleton />
    </div>
  );
}
