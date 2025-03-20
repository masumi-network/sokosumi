import { AgentDetailSkeleton } from "@/components/agents";

export default function Loading() {
  return (
    <div className="w-full p-8 xl:px-16">
      <AgentDetailSkeleton />
    </div>
  );
}
