import { AgentDetailSkeleton } from "@/components/agents";

export default function AgentDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8">
      <AgentDetailSkeleton />
    </div>
  );
}
