import { AgentDetailSkeleton } from "@/components/agents";

export default function AgentDetailLoading() {
  return (
    <div className="mx-auto flex justify-center px-4 py-8">
      <AgentDetailSkeleton />
    </div>
  );
}
